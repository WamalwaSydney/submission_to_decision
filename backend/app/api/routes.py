# API Routes — All REST endpoints

import os
import re
import random
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional
from uuid import UUID, uuid4
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, text, update, inspect as sa_inspect
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session
from app.auth import get_current_user, require_role, verify_password, get_password_hash, create_access_token
from app.models import (
    User, Committee, LegislativeItem, ParticipationReceipt, Message,
    CommitteeReport, ReportEntry, SubmissionMatch, RepresentativeProfile, NoticeRecord,
    ModerationAction, PasswordRecoveryCode,
)
from app.services import receipt_service, linking_service, ingestion_service, storage_service, notification_service
from app.services import submission_documents
from app.participation import participation_window
from app.submission_stage import STAGES, submission_stage
from app.audit import record_audit
from app import rate_limit
from app.password_reset import issue_reset, consume_reset
from app.recovery_codes import generate_recovery_codes as create_recovery_code_values, digest_recovery_code

router = APIRouter()
PUBLIC_SIGNUP_ROLES = {"citizen", "committee_officer"}
log = logging.getLogger(__name__)


async def _extract_and_match_uploaded_report(report_id: UUID, bill_id: UUID) -> None:
    """Run slow OCR after the upload response has been sent to the client."""
    try:
        async with async_session() as session:
            await ingestion_service.process_uploaded_report(report_id)
            await linking_service.propose_matches(session, bill_id, use_llm=True)
    except Exception:
        log.exception("Background upload extraction/matching failed for report %s", report_id)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    role: str = "citizen"
    committee_id: Optional[UUID] = None
    # Clerk's Office sign-up: the legislature the chosen committee must belong to.
    institution: Optional[str] = None
    notification_language: str = "en"


class PasswordResetComplete(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=12, max_length=128)


class PasswordRecoveryCodeRequest(BaseModel):
    email: EmailStr
    recovery_code: str = Field(min_length=32, max_length=32, pattern=r"^[a-f0-9]{32}$")
    password: str = Field(min_length=12, max_length=128)


class RecoveryCodeGenerationRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)


class CommitteeCreate(BaseModel):
    name: str
    institution: str
    description: Optional[str] = None
    contact_email: Optional[str] = None
    # Optional: a committee can exist before its Clerk's Office account does.
    account_name: Optional[str] = None
    account_email: Optional[str] = None
    account_password: Optional[str] = None


class BillCommitteeUpdate(BaseModel):
    committee_id: Optional[UUID] = None


class BillCommitteeConfirm(BaseModel):
    bill_ids: list[UUID] = Field(min_length=1, max_length=500)


class CommitteeOfficerApproval(BaseModel):
    committee_id: Optional[UUID] = None


class AdminUserUpdate(BaseModel):
    role: str
    status: str
    committee_id: Optional[UUID] = None


class BillCreate(BaseModel):
    title: str
    identifier: str
    stage: str = "Introduced"
    source_url: Optional[str] = None
    source_status: Optional[str] = None
    documents: list[dict] = []

class NotificationPreferenceUpdate(BaseModel):
    language: str

class ReportEntryUpdate(BaseModel):
    treatment: str
    stated_reason: Optional[str] = None


class MatchDecisionUpdate(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)


def public_user(user: User) -> dict:
    return {
        "id": str(user.id),
        "role": user.role,
        "name": user.name,
        "email": user.email,
        "status": user.status,
        "committee_id": str(user.committee_id) if user.committee_id else None,
        "created_date": user.created_date,
        "notification_language": ((user.privacy_prefs or {}).get("notification_language", "en")),
        "recovery_codes_configured": user.recovery_codes_generated_at is not None,
    }


# ============ Authentication ============

@router.post("/auth/login")
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    email = payload.email.strip().lower()
    rate_limit.check_login_allowed(request, email)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        rate_limit.record_login_failure(request, email)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    rate_limit.record_login_success(request, email)
    if user.status != "active":
        if user.status == "pending_approval":
            raise HTTPException(status_code=403, detail="Clerk’s Office access request is pending administrator approval")
        raise HTTPException(status_code=403, detail="Account is not active")
    token = create_access_token({"sub": str(user.id), "ver": user.auth_version or 0})
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@router.post("/auth/register")
async def register(payload: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit.check_account_request(request, "register")
    if payload.role not in PUBLIC_SIGNUP_ROLES:
        raise HTTPException(status_code=403, detail="This account type requires an administrator invitation or approval")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status_code=422, detail="Email is required")
    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    committee = None
    if payload.role == "committee_officer":
        if not payload.committee_id:
            raise HTTPException(status_code=422, detail="Select an existing committee")
        committee_result = await db.execute(
            select(Committee).where(Committee.id == payload.committee_id, Committee.status == "active")
        )
        committee = committee_result.scalar_one_or_none()
        if not committee:
            raise HTTPException(status_code=404, detail="Selected committee was not found or is inactive")
        if payload.institution and committee.institution.strip().casefold() != payload.institution.strip().casefold():
            raise HTTPException(status_code=422, detail=f"{committee.name} is a committee of the {committee.institution}, not the {payload.institution}")

    notification_language = "sw" if payload.notification_language == "sw" else "en"
    user = User(
        name=name,
        email=email,
        role=payload.role,
        password_hash=get_password_hash(payload.password),
        status="pending_approval" if payload.role == "committee_officer" else "active",
        committee_id=committee.id if committee else None,
        privacy_prefs={"show_name_publicly": False, "notification_language": notification_language},
    )
    db.add(user)
    await db.flush()
    # Create the initial backup set at signup. Return raw codes only in this
    # signup response; persist only their hashes for subsequent recovery.
    recovery_codes = create_recovery_code_values()
    user.recovery_codes_generated_at = datetime.now().astimezone()
    db.add_all([
        PasswordRecoveryCode(user_id=user.id, code_hash=digest_recovery_code(code))
        for code in recovery_codes
    ])
    await db.commit()
    await db.refresh(user)
    if payload.role == "committee_officer":
        return {
            "status": "pending_approval",
            "message": f"Your request to access {committee.name} has been sent for administrator approval. Save your recovery codes now; they will not be shown again.",
            "recovery_codes": recovery_codes,
        }
    token = create_access_token({"sub": str(user.id), "ver": user.auth_version or 0})
    response = {"access_token": token, "token_type": "bearer", "user": public_user(user), "recovery_codes": recovery_codes}
    return response


@router.post("/auth/recovery-codes")
async def generate_recovery_codes(
    payload: RecoveryCodeGenerationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    lock_result = await db.execute(
        select(User.id).where(User.id == current_user.id).with_for_update()
    )
    if lock_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=401, detail="Account is no longer available")
    codes = create_recovery_code_values()
    now = datetime.now().astimezone()
    # Rotation invalidates prior unspent codes. A recovery-code bundle is shown only once.
    await db.execute(
        update(PasswordRecoveryCode)
        .where(PasswordRecoveryCode.user_id == current_user.id, PasswordRecoveryCode.used_at.is_(None))
        .values(used_at=now)
    )
    db.add_all([
        PasswordRecoveryCode(user_id=current_user.id, code_hash=digest_recovery_code(code))
        for code in codes
    ])
    current_user.recovery_codes_generated_at = now
    await record_audit(
        db, entity_type="user", entity_id=current_user.id,
        action="password_recovery_codes_rotated", actor_id=current_user.id,
        details={"code_count": len(codes)},
    )
    await db.commit()
    return {"recovery_codes": codes, "message": "Save these codes offline. They will not be shown again."}


@router.post("/auth/password-reset/recovery-code")
async def reset_password_with_recovery_code(
    payload: PasswordRecoveryCodeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # Recovery codes are guessable by brute force without a limit.
    rate_limit.check_account_request(request, "recovery-reset")
    email = str(payload.email).strip().lower()
    user_result = await db.execute(
        select(User).where(User.email == email, User.status == "active").with_for_update()
    )
    user = user_result.scalar_one_or_none()
    code_hash = digest_recovery_code(payload.recovery_code)
    code_result = None
    if user:
        code_result = await db.execute(
            select(PasswordRecoveryCode).where(
                PasswordRecoveryCode.user_id == user.id,
                PasswordRecoveryCode.code_hash == code_hash,
                PasswordRecoveryCode.used_at.is_(None),
            ).with_for_update()
        )
    recovery_code = code_result.scalar_one_or_none() if code_result is not None else None
    if user is None or recovery_code is None:
        raise HTTPException(status_code=400, detail="Account details or recovery code are invalid")
    now = datetime.now().astimezone()
    user.password_hash = get_password_hash(payload.password)
    user.auth_version = (user.auth_version or 0) + 1
    user.recovery_codes_generated_at = None
    # Consume the supplied code and revoke the rest of this bundle; require
    # fresh authenticated enrollment before another recovery can be performed.
    await db.execute(
        update(PasswordRecoveryCode)
        .where(PasswordRecoveryCode.user_id == user.id, PasswordRecoveryCode.used_at.is_(None))
        .values(used_at=now)
    )
    await record_audit(
        db, entity_type="user", entity_id=user.id,
        action="password_reset_with_recovery_code", actor_id=user.id,
        details={"method": "offline_recovery_code"},
    )
    await db.commit()
    return {"message": "Password updated. Sign in and generate a new recovery-code set."}


@router.post("/users/{user_id}/password-reset")
async def issue_user_password_reset(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("administrator")),
):
    """Issue a one-time code after the administrator has independently verified identity."""
    result = await db.execute(select(User).where(User.id == user_id).with_for_update())
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.status != "active":
        raise HTTPException(status_code=409, detail="Only active accounts can be recovered")
    code, expires_at = await issue_reset(db, user)
    await record_audit(
        db,
        entity_type="user",
        entity_id=user.id,
        action="admin_password_reset_code_issued",
        actor_id=current_user.id,
        details={"expires_at": expires_at.isoformat()},
    )
    await db.commit()
    return {
        "reset_code": code,
        "expires_at": expires_at,
        "message": "Give this code to the user through a separately verified channel. It is shown only once.",
    }


@router.post("/auth/password-reset/complete")
async def complete_password_reset(payload: PasswordResetComplete, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit.check_account_request(request, "reset-complete")
    if not await consume_reset(db, payload.token, get_password_hash(payload.password)):
        await db.rollback()
        raise HTTPException(status_code=400, detail="Reset link is invalid or expired. Request a new password reset.")
    await db.commit()
    return {"message": "Password updated. Please sign in with your new password."}


@router.get("/auth/me")
async def me(current_user: User = Depends(get_current_user)):
    return {"user": public_user(current_user)}


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("administrator")),
):
    """Return the complete user registry for the administrator console."""
    result = await db.execute(select(User).order_by(User.created_date.desc(), User.name.asc()))
    return {"users": [public_user(user) for user in result.scalars().all()]}


@router.put("/users/{user_id}")
async def update_user(
    user_id: UUID,
    payload: AdminUserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("administrator")),
):
    allowed_roles = {"citizen", "committee_officer", "reviewer", "administrator"}
    allowed_statuses = {"active", "suspended", "pending_approval"}
    if payload.role not in allowed_roles:
        raise HTTPException(status_code=422, detail="Unsupported account role")
    if payload.status not in allowed_statuses:
        raise HTTPException(status_code=422, detail="Unsupported account status")
    if user_id == current_user.id and (payload.role != "administrator" or payload.status != "active"):
        raise HTTPException(status_code=409, detail="You cannot remove your own active administrator access")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.role == "committee_officer" and not payload.committee_id:
        raise HTTPException(status_code=422, detail="Clerk’s Office accounts must be linked to a committee")
    if payload.committee_id:
        committee_result = await db.execute(select(Committee).where(Committee.id == payload.committee_id, Committee.status == "active"))
        if not committee_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Selected committee was not found or is inactive")
    old_role, old_status = user.role, user.status
    user.role = payload.role
    user.status = payload.status
    user.committee_id = payload.committee_id if payload.role == "committee_officer" else None
    await record_audit(db, entity_type="user", entity_id=user.id, action="admin_user_updated", actor_id=current_user.id, details={"old_role": old_role, "new_role": user.role, "old_status": old_status, "new_status": user.status})
    await db.commit()
    await db.refresh(user)
    return {"user": public_user(user)}


@router.post("/users/{user_id}/approve-committee-officer")
async def approve_committee_officer(
    user_id: UUID,
    payload: CommitteeOfficerApproval,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("administrator")),
):
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user or user.role != "committee_officer":
        raise HTTPException(status_code=404, detail="Clerk’s Office access request not found")
    if user.status != "pending_approval":
        raise HTTPException(status_code=409, detail="This account is not awaiting approval")
    committee_id = payload.committee_id or user.committee_id
    if not committee_id:
        raise HTTPException(status_code=422, detail="Choose an existing committee for this officer")
    committee_result = await db.execute(
        select(Committee).where(Committee.id == committee_id, Committee.status == "active")
    )
    committee = committee_result.scalar_one_or_none()
    if not committee:
        raise HTTPException(status_code=404, detail="Selected committee was not found or is inactive")
    user.committee_id = committee.id
    user.status = "active"
    await record_audit(
        db,
        entity_type="user",
        entity_id=user.id,
        action="committee_officer_access_approved",
        actor_id=current_user.id,
        details={"committee_id": str(committee.id)},
    )
    await db.commit()
    await db.refresh(user)
    return {"user": public_user(user), "committee": to_dict(committee)}


# ============ Helpers ============

def to_dict(obj, exclude: set = frozenset()) -> dict:
    """Serialize an ORM object's columns only (no _sa_instance_state, no relationships)."""
    return {
        attr.key: getattr(obj, attr.key)
        for attr in sa_inspect(obj).mapper.column_attrs
        if attr.key not in exclude
    }


def report_to_dict(report: CommitteeReport) -> dict:
    """Serialize report data with source provenance separate from text extraction state."""
    data = to_dict(report)
    source_url = (report.source_url or "").strip()
    host = (urlparse(source_url).hostname or "").lower().rstrip(".")
    official_host = host == "parliament.go.ke" or host.endswith(".parliament.go.ke")
    official_source = official_host and source_url.lower().startswith(("https://", "http://")) and not report.is_simulated
    data["source_verification_status"] = "verified" if official_source else "unverified"
    data["source_verification_label"] = (
        "Official Parliament source verified" if official_source else "Source not verified as Parliament-hosted"
    )
    return data


PUBLIC_RECEIPT_EXCLUDE = {"author_id", "attachment_storage_ref"}
STAFF_DOCUMENT_ROLES = {"reviewer", "moderator", "administrator", "committee_officer"}


def normalize_public_id(value: str) -> str:
    """Receipt IDs are upper case; earlier versions end in a lower-case "-v<n>"."""
    return re.sub(r"-V(\d+)$", lambda match: "-v" + match.group(1), (value or "").strip().upper())


async def ensure_committee_scope(db: AsyncSession, user: User, bill_id) -> None:
    """Clerk's Office accounts may only act on bills assigned to their own committee.

    Moderators and administrators keep platform-wide access. A bill nobody has
    assigned yet must be assigned by an administrator first, so a committee
    cannot take over another committee's work by acting on it first.
    """
    if user.role != "committee_officer":
        return
    if not user.committee_id:
        raise HTTPException(status_code=403, detail="This Clerk's Office account is not linked to a committee yet. Ask an administrator to link it.")
    bill_committee = (await db.execute(select(LegislativeItem.committee_id).where(LegislativeItem.id == bill_id))).scalar_one_or_none()
    if bill_committee is None:
        raise HTTPException(status_code=403, detail="This bill is not assigned to your committee. Ask an administrator to assign it before you add committee records.")
    if bill_committee != user.committee_id:
        raise HTTPException(status_code=403, detail="This bill belongs to another committee. You can only manage your own committee's bills.")


def current_receipts():
    """Receipts that are the latest version of their submission (see receipt_service)."""
    return receipt_service.current_receipts()


async def notices_by_bill(db: AsyncSession, bill_ids=None) -> dict:
    query = select(NoticeRecord)
    if bill_ids is not None:
        query = query.where(NoticeRecord.bill_ref.in_(list(bill_ids)))
    grouped: dict = {}
    for notice in (await db.execute(query)).scalars().all():
        grouped.setdefault(notice.bill_ref, []).append(notice)
    return grouped


def bill_with_participation(bill_dict: dict, notices) -> dict:
    bill_dict["participation"] = participation_window(bill_dict.get("stage"), notices)
    return bill_dict


async def receipt_stages(db: AsyncSession, bill: LegislativeItem, receipts) -> dict:
    """Each receipt's stage: received → with the committee → report published → under review → outcome."""
    receipt_ids = [receipt.id for receipt in receipts]
    if not receipt_ids:
        return {}
    matches = list((await db.execute(select(SubmissionMatch).where(SubmissionMatch.receipt_ref.in_(receipt_ids)))).scalars().all())
    entry_ids = [match.report_entry_ref for match in matches if match.reviewer_decision == "confirmed"]
    entries = {entry.id: entry for entry in (await db.execute(select(ReportEntry).where(ReportEntry.id.in_(entry_ids)))).scalars().all()} if entry_ids else {}
    report_published = (await db.execute(select(CommitteeReport.id).where(CommitteeReport.bill_ref == bill.id).limit(1))).scalar_one_or_none() is not None
    notices = await notices_by_bill(db, [bill.id])
    accepting = participation_window(bill.stage, notices.get(bill.id, []))["accepting"]
    by_receipt: dict = {}
    for match in matches:
        by_receipt.setdefault(match.receipt_ref, []).append(match)
    return {
        receipt_id: submission_stage(by_receipt.get(receipt_id, []), entries, report_published, accepting)
        for receipt_id in receipt_ids
    }


def public_receipt_dict(receipt: ParticipationReceipt) -> dict:
    data = to_dict(receipt, exclude=PUBLIC_RECEIPT_EXCLUDE)
    # Citizens always see their original receipt ID; this version's own ID
    # ("<ID>-v<n>" after an edit) is kept alongside for the chain record.
    data["public_id"] = receipt_service.stable_id_of(receipt)
    data["version_id"] = receipt_service.version_id_of(receipt)
    data["has_document"] = bool(receipt.attachment_sha256)
    return data


# ============ Committees ============

@router.get("/committees")
async def list_committees(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Committee).where(Committee.status == "active", ~Committee.name.ilike("%simulated%")).order_by(Committee.name.asc()))
    return {"committees": [to_dict(c) for c in result.scalars().all()]}

@router.post("/committees")
async def create_committee(payload: CommitteeCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_role("administrator"))):
    wants_account = any((payload.account_name, payload.account_email, payload.account_password))
    if wants_account:
        if not (payload.account_name and payload.account_email and payload.account_password):
            raise HTTPException(status_code=422, detail="Give the account name, email and password, or leave all three empty")
        if len(payload.account_password) < 12 or len(payload.account_password) > 128:
            raise HTTPException(status_code=422, detail="Clerk’s Office account password must be between 12 and 128 characters")
        existing = await db.execute(select(User).where(User.email == payload.account_email.strip().lower()))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Clerk’s Office account email already exists")
    if (await db.execute(select(Committee.id).where(Committee.name == payload.name.strip()))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A committee with this name already exists")
    committee = Committee(name=payload.name.strip(), institution=payload.institution.strip(), description=payload.description, contact_email=payload.contact_email, created_by=current_user.id)
    db.add(committee); await db.flush()
    account = None
    if wants_account:
        account = User(name=payload.account_name.strip(), email=payload.account_email.strip().lower(), role="committee_officer", password_hash=get_password_hash(payload.account_password), committee_id=committee.id, status="active")
        db.add(account)
    await record_audit(db, entity_type="committee", entity_id=committee.id, action="created", actor_id=current_user.id, details={"name": committee.name, "institution": committee.institution})
    await db.commit(); await db.refresh(committee)
    return {"committee": to_dict(committee), "account": public_user(account) if account else None}

@router.get("/committees/me/bills")
async def committee_bills(db: AsyncSession = Depends(get_db), current_user: User = Depends(require_role("committee_officer"))):
    result = await db.execute(select(LegislativeItem).where(LegislativeItem.committee_id == current_user.committee_id, LegislativeItem.is_simulated.is_(False)).order_by(LegislativeItem.source_updated_at.desc().nullslast(), LegislativeItem.title.asc()))
    return {"bills": [to_dict(b) for b in result.scalars().all()]}

@router.post("/committees/me/bills")
async def committee_ingest_bill(
    title: str = Form(...),
    identifier: str = Form(...),
    stage: str = Form("Introduced"),
    source_url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer")),
):
    if not current_user.committee_id:
        raise HTTPException(status_code=409, detail="Clerk’s Office account is not linked to a committee")
    clean_title = title.strip()
    clean_identifier = identifier.strip()
    if not clean_title or not clean_identifier:
        raise HTTPException(status_code=422, detail="Bill title and identifier are required")
    duplicate = await db.execute(select(LegislativeItem).where(LegislativeItem.identifier == clean_identifier))
    if duplicate.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A bill with this identifier already exists")
    committee_result = await db.execute(select(Committee).where(Committee.id == current_user.committee_id))
    committee = committee_result.scalar_one_or_none()
    if not committee:
        raise HTTPException(status_code=409, detail="The linked committee no longer exists")

    documents = []
    if file:
        is_pdf = file.content_type == "application/pdf" or (file.filename or "").lower().endswith(".pdf")
        if not is_pdf:
            raise HTTPException(status_code=422, detail="Bill documents must be PDF files")
        content = await file.read()
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="The bill document must be 50 MB or smaller")
        stored = storage_service.persist_report(content, file.filename or "bill.pdf")
        documents.append({"name": file.filename or "bill.pdf", **stored})

    bill = LegislativeItem(
        title=clean_title,
        identifier=clean_identifier,
        institution=committee.institution,
        stage=stage,
        documents=documents,
        source_url=source_url.strip() if source_url else None,
        source_status="committee-ingested",
        source_updated_at=date.today(),
        committee_id=committee.id,
        committee_assignment_source="official record",
        is_simulated=False,
    )
    bill.status_history = [{"date": date.today().isoformat(), "stage": stage, "note": "Bill ingested by committee"}]
    db.add(bill); await db.flush()
    await record_audit(db, entity_type="legislative_item", entity_id=bill.id, action="ingested_by_committee", actor_id=current_user.id, details={"committee_id": str(committee.id), "identifier": bill.identifier})
    await db.commit(); await db.refresh(bill)
    return {"bill": to_dict(bill)}

# ============ Bills ============

@router.get("/bills")
async def list_bills(
    institution: Optional[str] = None,
    stage: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(LegislativeItem).where(LegislativeItem.is_simulated.is_(False))

    if institution:
        query = query.where(LegislativeItem.institution == institution)
    if stage:
        query = query.where(LegislativeItem.stage == stage)
    if search:
        pattern = f"%{search}%"
        query = query.where(
            LegislativeItem.title.ilike(pattern)
            | LegislativeItem.identifier.ilike(pattern)
        )

    result = await db.execute(query)
    bills = result.scalars().all()
    notices = await notices_by_bill(db)

    return {"bills": [bill_with_participation(to_dict(b), notices.get(b.id, [])) for b in bills]}


@router.put("/bills/{bill_id}/committee")
async def set_bill_committee(
    bill_id: UUID,
    payload: BillCommitteeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("administrator")),
):
    """Assign (or clear) the committee for a bill. The sync never overrides this."""
    bill = (await db.execute(select(LegislativeItem).where(LegislativeItem.id == bill_id))).scalar_one_or_none()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if payload.committee_id:
        committee = (await db.execute(select(Committee).where(Committee.id == payload.committee_id))).scalar_one_or_none()
        if not committee:
            raise HTTPException(status_code=404, detail="Committee not found")
        if committee.institution.strip().casefold() != bill.institution.strip().casefold():
            raise HTTPException(status_code=422, detail=f"That committee belongs to the {committee.institution}, not the {bill.institution}")
    previous = bill.committee_id
    bill.committee_id = payload.committee_id
    bill.committee_assignment_source = "administrator" if payload.committee_id else None
    await record_audit(db, entity_type="legislative_item", entity_id=bill.id, action="committee_assigned", actor_id=current_user.id,
                       details={"from": str(previous) if previous else None, "to": str(payload.committee_id) if payload.committee_id else None})
    await db.commit()
    return {"bill": to_dict(bill)}


@router.post("/bills/committee/confirm")
async def confirm_bill_committees(
    payload: BillCommitteeConfirm,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("administrator")),
):
    """Accept subject-matter suggestions as they are, for many bills at once."""
    bills = list((await db.execute(select(LegislativeItem).where(
        LegislativeItem.id.in_(payload.bill_ids), LegislativeItem.committee_id.is_not(None),
    ))).scalars().all())
    for bill in bills:
        bill.committee_assignment_source = "administrator"
        await record_audit(db, entity_type="legislative_item", entity_id=bill.id, action="committee_confirmed", actor_id=current_user.id,
                           details={"committee_id": str(bill.committee_id)})
    await db.commit()
    return {"confirmed": len(bills)}


@router.get("/bills/{bill_id}")
async def get_bill(bill_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(LegislativeItem).where(LegislativeItem.id == bill_id, LegislativeItem.is_simulated.is_(False))
    )
    bill = result.scalar_one_or_none()

    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    receipts_result = await db.execute(
        current_receipts().where(ParticipationReceipt.legislative_item_id == bill_id)
    )
    receipts = receipts_result.scalars().all()

    stages = await receipt_stages(db, bill, receipts)
    outcome_counts = {stage: 0 for stage in STAGES}
    for stage in stages.values():
        outcome_counts[stage] += 1

    committee = None
    if bill.committee_id:
        c_result = await db.execute(select(Committee).where(Committee.id == bill.committee_id))
        c = c_result.scalar_one_or_none()
        committee = to_dict(c) if c else None
    notices = await notices_by_bill(db, [bill.id])
    return {
        **bill_with_participation(to_dict(bill), notices.get(bill.id, [])),
        "committee": committee,
        "outcome_counts": outcome_counts,
        "total_submissions": len(receipts),
    }


@router.get("/bootstrap")
async def bootstrap(db: AsyncSession = Depends(get_db)):
    """Return the non-secret application data needed by the initial client shell."""
    async def all_rows(model, exclude=frozenset()):
        query = select(model)
        if model in (LegislativeItem, CommitteeReport):
            query = query.where(model.is_simulated.is_(False))
        if model is Committee:
            query = query.where(~Committee.name.ilike("%simulated%"))
        result = await db.execute(query)
        rows = result.scalars().all()
        return [report_to_dict(row) if model is CommitteeReport else to_dict(row, exclude=exclude) for row in rows]

    bills = await all_rows(LegislativeItem)
    live_bill_ids = {bill["id"] for bill in bills}
    reports = await all_rows(CommitteeReport)
    live_report_ids = {report["id"] for report in reports}
    receipt_rows = (await db.execute(current_receipts())).scalars().all()
    receipts = [public_receipt_dict(receipt) for receipt in receipt_rows if receipt.legislative_item_id in live_bill_ids]
    notices = [notice for notice in await all_rows(NoticeRecord) if notice.get("bill_ref") in live_bill_ids]
    bill_notices: dict = {}
    for notice in notices:
        bill_notices.setdefault(notice["bill_ref"], []).append(notice)
    for bill in bills:
        bill_with_participation(bill, bill_notices.get(bill["id"], []))
    report_entries = [entry for entry in await all_rows(ReportEntry) if entry.get("report_ref") in live_report_ids]
    report_entry_ids = {entry["id"] for entry in report_entries}
    matches = [match for match in await all_rows(SubmissionMatch) if match.get("report_entry_ref") in report_entry_ids]
    confirmed_receipt_ids = {match["receipt_ref"] for match in matches if match.get("reviewer_decision") == "confirmed"}
    for receipt in receipts:
        if receipt.get("id") in confirmed_receipt_ids:
            receipt["lodging_status"] = "acknowledged"

    return {
        "committees": await all_rows(Committee),
        "bills": bills,
        "receipts": receipts,
        "reports": reports,
        "report_entries": report_entries,
        "matches": matches,
        "notices": notices,
        "profiles": [profile for profile in await all_rows(RepresentativeProfile, exclude=PROFILE_PUBLIC_EXCLUDE) if profile.get("profile_label") != "simulated"],
    }


# ============ Public bill flow ============

@router.get("/bills/{bill_id}/flow")
async def bill_flow(
    bill_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    bill_result = await db.execute(select(LegislativeItem).where(LegislativeItem.id == bill_id))
    bill = bill_result.scalar_one_or_none()
    if not bill: raise HTTPException(status_code=404, detail="Bill not found")
    reports_result = await db.execute(select(CommitteeReport).where(CommitteeReport.bill_ref == bill.id).order_by(CommitteeReport.date_tabled.asc()))
    reports = list(reports_result.scalars().all())
    entries = []
    for report in reports:
        entry_result = await db.execute(select(ReportEntry).where(ReportEntry.report_ref == report.id))
        entries.extend(entry_result.scalars().all())
    # Pending reports are read by the background report worker, not by page views.
    receipt_result = await db.execute(current_receipts().where(ParticipationReceipt.legislative_item_id == bill.id).order_by(ParticipationReceipt.timestamp.asc()))
    submissions = []
    flow_receipts = list(receipt_result.scalars().all())
    stages = await receipt_stages(db, bill, flow_receipts)
    for receipt in flow_receipts:
        match_result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.receipt_ref == receipt.id).order_by(SubmissionMatch.confidence_score.desc()))
        receipt_matches = list(match_result.scalars().all())
        match = (
            next((item for item in receipt_matches if item.reviewer_decision == "confirmed"), None)
            or next((item for item in receipt_matches if item.reviewer_decision == "pending"), None)
            or next((item for item in receipt_matches if item.reviewer_decision == "rejected"), None)
        )
        confirmed_match = match if match and match.reviewer_decision == "confirmed" else None
        entry = next((e for e in entries if confirmed_match and e.id == confirmed_match.report_entry_ref), None)
        status = stages[receipt.id]
        submissions.append({"public_id": receipt_service.stable_id_of(receipt), "timestamp": receipt.timestamp, "clause_ref": receipt.clause_ref, "status": status, "match_percentage": round(match.confidence_score * 100, 1) if match else None, "match_decision": match.reviewer_decision if match else None, "reason": entry.stated_reason if entry and confirmed_match else (match.reviewer_reason if match and match.reviewer_decision == "rejected" else None)})
    flow_notices = await notices_by_bill(db, [bill.id])
    return {"bill": bill_with_participation(to_dict(bill), flow_notices.get(bill.id, [])), "flow": [{"stage": h.get("stage"), "date": h.get("date"), "note": h.get("note")} for h in (bill.status_history or [])], "reports": [report_to_dict(r) for r in reports], "report_entries": [to_dict(e) for e in entries], "submissions": submissions}

# ============ Messages ============

@router.get("/messages")
async def list_messages(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "citizen":
        raise HTTPException(status_code=403, detail="Automated notification inbox is for citizen accounts")
    query = select(Message).where(Message.recipient_user_id == current_user.id)
    result = await db.execute(query.order_by(Message.created_at.desc()))
    return {"messages": [to_dict(m) for m in result.scalars().all()]}

@router.put("/messages/preferences")
async def update_message_preferences(
    payload: NotificationPreferenceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "citizen":
        raise HTTPException(status_code=403, detail="Only citizen accounts have notification preferences")
    if payload.language not in {"en", "sw"}:
        raise HTTPException(status_code=422, detail="Language must be en or sw")
    preferences = dict(current_user.privacy_prefs or {})
    preferences["notification_language"] = payload.language
    current_user.privacy_prefs = preferences
    await db.commit()
    await db.refresh(current_user)
    return {"notification_language": payload.language}
@router.put("/messages/{message_id}/read")
async def mark_message_read(message_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Message).where(Message.id == message_id))
    message = result.scalar_one_or_none()
    if not message: raise HTTPException(status_code=404, detail="Message not found")
    allowed = current_user.role == "citizen" and message.recipient_user_id == current_user.id
    if not allowed: raise HTTPException(status_code=403, detail="Message is not addressed to this account")
    message.is_read = True
    await record_audit(db, entity_type="message", entity_id=message.id, action="viewed", actor_id=current_user.id, details={})
    await db.commit()
    return {"message": to_dict(message)}

# ============ Receipts ============

async def _load_open_bill(db: AsyncSession, legislative_item_id: str) -> LegislativeItem:
    try:
        bill_uuid = UUID(legislative_item_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Bill not found")
    bill = (await db.execute(select(LegislativeItem).where(LegislativeItem.id == bill_uuid))).scalar_one_or_none()
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    notices = await notices_by_bill(db, [bill.id])
    window = participation_window(bill.stage, notices.get(bill.id, []))
    if not window["accepting"]:
        raise HTTPException(status_code=409, detail=window["reason"])
    return bill


async def _read_document(document: Optional[UploadFile]) -> Optional[dict]:
    if document is None or not document.filename:
        return None
    content = await document.read(submission_documents.MAX_BYTES + 1)
    try:
        return submission_documents.store(content, document.filename)
    except submission_documents.DocumentRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _submission_body(submission_text: Optional[str], attachment: Optional[dict]) -> str:
    """Typed text wins; a document-only submission uses the document's text."""
    typed = (submission_text or "").strip()
    if typed:
        return typed
    if attachment:
        return attachment.get("text") or ""
    raise HTTPException(status_code=422, detail="Write your submission or upload it as a document.")


async def _matching_status(db: AsyncSession, bill: LegislativeItem, receipt: ParticipationReceipt) -> tuple[list, str]:
    """Re-run matching so the new receipt enters the moderator queue too."""
    match_proposals = await linking_service.propose_matches(db, bill.id, use_llm=True)
    receipt_match_proposals = [match for match in match_proposals if match.receipt_ref == receipt.id]
    linked_reports = list((await db.execute(select(CommitteeReport).where(CommitteeReport.bill_ref == bill.id))).scalars().all())
    report_has_entries = (await db.execute(
        select(ReportEntry.id)
        .join(CommitteeReport, ReportEntry.report_ref == CommitteeReport.id)
        .where(CommitteeReport.bill_ref == bill.id)
        .limit(1)
    )).scalar_one_or_none() is not None

    def house_key(value):
        if not value:
            return None
        normalized = value.strip().casefold()
        if "senate" in normalized:
            return "senate"
        if normalized == "na" or "national assembly" in normalized:
            return "na"
        return normalized

    report_reference_mismatch = any(
        (report.bill_year is not None and bill.bill_year is not None and report.bill_year != bill.bill_year)
        or (report.bill_number is not None and bill.bill_number is not None and report.bill_number != bill.bill_number)
        or (report.bill_house and bill.bill_house and house_key(report.bill_house) != house_key(bill.bill_house))
        for report in linked_reports
    )
    if receipt_match_proposals:
        status = "pending_review"
    elif not linked_reports:
        status = "submission_triage"
    elif report_reference_mismatch:
        status = "report_reference_mismatch"
    elif not report_has_entries:
        status = "report_extraction_required"
    else:
        status = "already_processed"
    return receipt_match_proposals, status


def _receipt_response(receipt: ParticipationReceipt, match_proposals: list, matching_status: str) -> dict:
    return {
        "receipt_id": receipt.id,
        "public_id": receipt_service.stable_id_of(receipt),
        "version_id": receipt.public_id,
        "timestamp": receipt.timestamp,
        "status": "received",
        "hash": receipt.hash,
        "previous_hash": receipt.previous_hash,
        "revision": receipt.revision,
        "receipt": public_receipt_dict(receipt),
        "match_proposals": [to_dict(match) for match in match_proposals],
        "matching_status": matching_status,
    }


async def _current_receipt_for(db: AsyncSession, author_id, bill_id) -> Optional[ParticipationReceipt]:
    result = await db.execute(
        current_receipts()
        .where(ParticipationReceipt.author_id == author_id, ParticipationReceipt.legislative_item_id == bill_id)
        .order_by(ParticipationReceipt.timestamp.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.post("/receipts")
async def create_receipt(
    legislative_item_id: str = Form(...),
    clause_ref: Optional[str] = Form(None),
    submission_text: Optional[str] = Form(None),
    show_name_publicly: bool = Form(False),
    document: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "citizen":
        raise HTTPException(status_code=403, detail="Only citizens can submit views")

    recent_cutoff = datetime.utcnow() - timedelta(hours=1)
    recent_result = await db.execute(
        select(ParticipationReceipt.id).where(
            ParticipationReceipt.author_id == current_user.id,
            ParticipationReceipt.timestamp >= recent_cutoff,
        )
    )
    if len(recent_result.scalars().all()) >= 5:
        raise HTTPException(status_code=429, detail="Submission limit reached; try again later")

    bill = await _load_open_bill(db, legislative_item_id)
    attachment = await _read_document(document)
    body = _submission_body(submission_text, attachment)

    # One submission per citizen per bill. The chain lock serialises all
    # receipt writes, so two concurrent requests cannot both pass this check.
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('participation_receipts_chain'))"))
    existing = await _current_receipt_for(db, current_user.id, bill.id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"You already made a submission on this bill (receipt {existing.public_id}). You can edit it instead.",
        )

    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    public_id = "RCT-" + "".join(random.choices(chars, k=6))

    receipt = await receipt_service.create_receipt(
        db=db,
        author_id=current_user.id,
        legislative_item_id=bill.id,
        clause_ref=(clause_ref or "").strip() or None,
        submission_text=body,
        public_id=public_id,
        show_name=show_name_publicly,
        author_name=current_user.name if show_name_publicly else None,
        attachment=attachment,
    )

    match_proposals, matching_status = await _matching_status(db, bill, receipt)
    await notification_service.notify_receipt_event(
        db, receipt, f"receipt:{receipt.id}:submitted", "submission_received",
    )
    return _receipt_response(receipt, match_proposals, matching_status)


@router.put("/receipts/{public_id}")
async def edit_receipt(
    public_id: str,
    clause_ref: Optional[str] = Form(None),
    submission_text: Optional[str] = Form(None),
    show_name_publicly: bool = Form(False),
    remove_document: bool = Form(False),
    document: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit a submission while the bill's call for views is open.

    The receipt chain is append-only: an edit is recorded as a new chain entry
    that keeps the citizen's receipt ID. The earlier version stays verifiable
    under "<receipt ID>-v<revision>".
    """
    receipt = await receipt_service.resolve_receipt(db, normalize_public_id(public_id))
    if not receipt or receipt.author_id != current_user.id:
        raise HTTPException(status_code=404, detail="Submission not found")
    if await receipt_service.has_newer_version(db, receipt):
        raise HTTPException(status_code=409, detail="This is an earlier version of your submission. Edit the current version instead.")
    bill = await _load_open_bill(db, str(receipt.legislative_item_id))

    reviewed = (await db.execute(
        select(SubmissionMatch.id).where(
            SubmissionMatch.receipt_ref == receipt.id,
            SubmissionMatch.reviewer_decision.in_(["confirmed", "rejected"]),
        ).limit(1)
    )).scalar_one_or_none()
    if reviewed:
        raise HTTPException(status_code=409, detail="A moderator has already reviewed this submission against the committee report, so it can no longer be edited.")

    new_document = await _read_document(document)
    if new_document:
        attachment = new_document
    elif receipt.attachment_sha256 and not remove_document:
        attachment = {
            "name": receipt.attachment_name, "mime_type": receipt.attachment_mime_type,
            "size_bytes": receipt.attachment_size_bytes, "sha256": receipt.attachment_sha256,
            "storage_ref": receipt.attachment_storage_ref, "text": "",
        }
        if not (submission_text or "").strip():
            # Keep the document's text when only the clause or privacy setting changed.
            attachment["text"] = receipt.submission_text
    else:
        attachment = None
    body = _submission_body(submission_text, attachment)

    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('participation_receipts_chain'))"))
    stable_id = receipt_service.stable_id_of(receipt)
    # Proposals for the earlier version no longer apply (match rows are not append-only).
    await db.execute(
        update(SubmissionMatch)
        .where(SubmissionMatch.receipt_ref == receipt.id, SubmissionMatch.reviewer_decision == "pending")
        .values(reviewer_decision="superseded")
    )
    await db.flush()

    revised = await receipt_service.create_receipt(
        db=db,
        author_id=current_user.id,
        legislative_item_id=bill.id,
        clause_ref=(clause_ref or "").strip() or None,
        submission_text=body,
        public_id=f"{stable_id}-v{receipt.revision + 1}",
        show_name=show_name_publicly,
        author_name=current_user.name if show_name_publicly else None,
        attachment=attachment,
        revision=receipt.revision + 1,
        submission_ref=stable_id,
    )
    await record_audit(db, entity_type="receipt", entity_id=revised.id, action="revised", actor_id=current_user.id,
                       details={"public_id": stable_id, "version_id": revised.public_id, "previous_version": receipt.public_id, "revision": revised.revision})
    await db.commit()
    match_proposals, matching_status = await _matching_status(db, bill, revised)
    response = _receipt_response(revised, match_proposals, matching_status)
    response["superseded_receipt_id"] = receipt.id
    return response


@router.get("/receipts/mine/{bill_id}")
async def my_receipt_for_bill(
    bill_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    receipt = await _current_receipt_for(db, current_user.id, bill_id)
    if not receipt:
        return {"receipt": None}
    reviewed = (await db.execute(
        select(SubmissionMatch.id).where(
            SubmissionMatch.receipt_ref == receipt.id,
            SubmissionMatch.reviewer_decision.in_(["confirmed", "rejected"]),
        ).limit(1)
    )).scalar_one_or_none()
    data = public_receipt_dict(receipt)
    data["show_name_publicly"] = bool(receipt.author_name_public)
    data["editable"] = reviewed is None
    return {"receipt": data}


@router.get("/receipts/{public_id}/document")
async def download_receipt_document(
    public_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The uploaded memorandum file is shown to its author and parliamentary staff.

    Its extracted text is public on the bill page like a typed submission, but
    the original file can carry signatures and contact details.
    """
    receipt = await receipt_service.resolve_receipt(db, normalize_public_id(public_id))
    if not receipt or not receipt.attachment_storage_ref:
        raise HTTPException(status_code=404, detail="No document is attached to this submission")
    if receipt.author_id != current_user.id and current_user.role not in STAFF_DOCUMENT_ROLES:
        raise HTTPException(status_code=403, detail="Only the author and parliamentary staff can open the original document")
    path = submission_documents.path_for(receipt.attachment_storage_ref)
    if not path:
        raise HTTPException(status_code=404, detail="The document file is no longer available")
    return FileResponse(path, media_type=receipt.attachment_mime_type or "application/octet-stream", filename=receipt.attachment_name or path.name)


# NOTE: /receipts/verify MUST be declared before /receipts/{public_id},
# otherwise "verify" is captured as a public_id.
@router.get("/receipts/verify")
async def verify_chain(db: AsyncSession = Depends(get_db)):
    return await receipt_service.verify_chain(db)


@router.get("/receipts/{public_id}/verify")
async def verify_one_receipt(public_id: str, db: AsyncSession = Depends(get_db)):
    """Let anyone check a single receipt without downloading the whole chain."""
    result = await receipt_service.verify_receipt(db, normalize_public_id(public_id))
    if result is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return result


@router.get("/receipts/my")
async def my_receipts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        current_receipts().where(ParticipationReceipt.author_id == current_user.id)
    )
    receipts = list(result.scalars().all())
    receipt_ids = [receipt.id for receipt in receipts]
    confirmed_result = await db.execute(select(SubmissionMatch.receipt_ref).where(
        SubmissionMatch.receipt_ref.in_(receipt_ids), SubmissionMatch.reviewer_decision == "confirmed"
    )) if receipt_ids else None
    confirmed_ids = set(confirmed_result.scalars().all()) if confirmed_result is not None else set()
    payload = [public_receipt_dict(receipt) for receipt in receipts]
    for item in payload:
        if item["id"] in confirmed_ids:
            item["lodging_status"] = "acknowledged"
    return {"receipts": payload}


@router.get("/receipts/review-queue")
async def review_queue_receipts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    result = await db.execute(
        current_receipts().order_by(ParticipationReceipt.timestamp.desc())
    )
    # Moderators need submission content and receipt identifiers for review, but
    # author account IDs are internal and must not be exposed in this queue.
    return {"receipts": [public_receipt_dict(receipt) for receipt in result.scalars().all()]}


@router.get("/receipts/{public_id}")
async def get_receipt(public_id: str, db: AsyncSession = Depends(get_db)):
    receipt = await receipt_service.resolve_receipt(db, normalize_public_id(public_id))

    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    bill_result = await db.execute(
        select(LegislativeItem).where(LegislativeItem.id == receipt.legislative_item_id)
    )
    bill = bill_result.scalar_one()

    match_result = await db.execute(
        select(SubmissionMatch)
        .where(SubmissionMatch.receipt_ref == receipt.id)
        .order_by(SubmissionMatch.confidence_score.desc())
    )
    receipt_matches = list(match_result.scalars().all())
    match = (
        next((item for item in receipt_matches if item.reviewer_decision == "confirmed"), None)
        or next((item for item in receipt_matches if item.reviewer_decision == "pending"), None)
        or next((item for item in receipt_matches if item.reviewer_decision == "rejected"), None)
    )
    match_decision = match.reviewer_decision if match else None

    match_data = None
    if match and match.reviewer_decision in {"confirmed", "rejected"}:
        entry_result = await db.execute(
            select(ReportEntry).where(ReportEntry.id == match.report_entry_ref)
        )
        entry = entry_result.scalar_one_or_none()
        if entry or match.reviewer_decision == "rejected":
            match_data = {
                "method": match.match_method,
                "confidence": match.confidence_score,
                "explanation": match.explanation,
                # A moderator rejecting the proposed match means the report does not respond to it.
                "treatment": (entry.treatment if entry and entry.treatment not in {"unclassified", "awaiting committee report"} else "adopted") if match.reviewer_decision == "confirmed" else "not addressed",
                "stated_reason": entry.stated_reason if entry and match.reviewer_decision == "confirmed" else match.reviewer_reason,
                "decided_by": "committee report" if match.reviewer_decision == "confirmed" else "moderator",
            }

    stable_id = receipt_service.stable_id_of(receipt)
    superseded = await receipt_service.has_newer_version(db, receipt)
    return {
        # An earlier version is shown as "<ID>-v<n>"; the current one by the receipt ID.
        "public_id": f"{stable_id}-v{receipt.revision}" if superseded else stable_id,
        "current_public_id": stable_id,
        "version_id": receipt.public_id,
        "revision": receipt.revision,
        "superseded": superseded,
        "document": {
            "name": receipt.attachment_name,
            "mime_type": receipt.attachment_mime_type,
            "size_bytes": receipt.attachment_size_bytes,
            "sha256": receipt.attachment_sha256,
        } if receipt.attachment_sha256 else None,
        "legislative_item_id": receipt.legislative_item_id,
        "bill_title": bill.title,
        "clause_ref": receipt.clause_ref,
        "submission_text": receipt.submission_text,
        "timestamp": receipt.timestamp,
        "status": (await receipt_stages(db, bill, [receipt]))[receipt.id],
        "match_decision": match_decision,
        "lodging_status": "acknowledged" if match and match.reviewer_decision == "confirmed" else receipt.lodging_status,
        "hash": receipt.hash,
        "previous_hash": receipt.previous_hash,
        "match": match_data,
    }


# ============ Matches ============

@router.get("/matches/pending")
async def get_pending_matches(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    matches = await linking_service.get_pending_matches(db)
    return {"matches": [to_dict(match) for match in matches]}


@router.post("/matches/auto-process")
async def auto_process_matches(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    bill_result = await db.execute(
        select(ParticipationReceipt.legislative_item_id)
        .join(CommitteeReport, CommitteeReport.bill_ref == ParticipationReceipt.legislative_item_id)
        .distinct()
    )
    processed = 0
    created = 0
    for bill_id in bill_result.scalars().all():
        processed += 1
        created += len(await linking_service.propose_matches(db, bill_id, use_llm=True))
    return {"bills_processed": processed, "proposals_created": created}


@router.post("/matches/{match_id}/confirm")
async def confirm_match(
    match_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    try:
        match = await linking_service.confirm_match(db, match_id, current_user.id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Match not found")
    return {"match": match}


@router.post("/matches/{match_id}/reject")
async def reject_match(
    match_id: UUID,
    payload: MatchDecisionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    if not payload.reason or not payload.reason.strip():
        raise HTTPException(status_code=422, detail="A reason is required when rejecting a submission match")
    try:
        match = await linking_service.reject_match(db, match_id, current_user.id, payload.reason.strip())
    except ValueError:
        raise HTTPException(status_code=404, detail="Match not found")
    return {"match": match}


# ============ Reports ============

@router.post("/reports/upload")
async def upload_report(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    bill_ref: str = Form(...),
    institution: str = Form(...),
    date_tabled: str = Form(...),
    source_url: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer")),
):
    if file.content_type != "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Committee reports must be PDF files")
    content = await file.read()
    if len(content) > 35 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The report must be 35 MB or smaller")
    try:
        bill_uuid = UUID(bill_ref)
    except ValueError:
        raise HTTPException(status_code=422, detail="Select a bill from the platform")
    if (await db.execute(select(LegislativeItem.id).where(LegislativeItem.id == bill_uuid))).scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    await ensure_committee_scope(db, current_user, bill_uuid)
    provenance = storage_service.persist_report(content, file.filename or "report.pdf")
    report = CommitteeReport(
        bill_ref=bill_uuid,
        institution=institution.strip(),
        date_tabled=date.fromisoformat(date_tabled),
        source_document_ref=Path(provenance["storage_ref"]).name,
        source_url=source_url,
        extraction_status="pending",
        ocr_used=False,
        source_sha256=provenance["sha256"],
        source_mime_type=provenance["mime_type"],
        source_size_bytes=provenance["size_bytes"],
        source_storage_ref=provenance["storage_ref"],
        provenance={
            "original_filename": os.path.basename(file.filename or "report.pdf"),
            "uploaded_at": datetime.utcnow().isoformat() + "Z",
            "sha256": provenance["sha256"],
            "storage_ref": provenance["storage_ref"],
        },
        uploaded_by=current_user.id,
    )
    db.add(report)
    await db.flush()
    await record_audit(db, entity_type="committee_report", entity_id=report.id,
                       action="uploaded", actor_id=current_user.id,
                       details={"sha256": provenance["sha256"], "source_url": source_url})
    await db.commit()
    report_receipts = await db.execute(current_receipts().where(ParticipationReceipt.legislative_item_id == report.bill_ref))
    for receipt in report_receipts.scalars().all():
        await notification_service.notify_receipt_event(
            db, receipt, f"report:{report.id}:receipt:{receipt.id}:received", "report_received",
        )
    await db.commit()
    background_tasks.add_task(_extract_and_match_uploaded_report, report.id, bill_uuid)

    return {
        "report_id": report.id,
        "source_sha256": report.source_sha256,
        "source_url": report.source_url,
        "source_storage_ref": report.source_storage_ref,
        "extraction_status": "pending",
        "ocr_used": report.ocr_used,
        "match_proposals": [],
        "processing": True,
    }


@router.get("/reports/{report_id}/document")
async def open_report_document(report_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CommitteeReport).where(CommitteeReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Committee report not found")

    if report.source_url:
        parsed = urlparse(report.source_url)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return RedirectResponse(report.source_url)

    # Uploaded report refs are stored as a generated filename. Resolve only the
    # basename inside the configured storage directory to prevent path traversal.
    filename = Path(report.source_document_ref or "").name
    report_path = storage_service.STORAGE_DIR / filename
    if not filename or not report_path.is_file():
        raise HTTPException(status_code=404, detail="Report document is unavailable")
    return FileResponse(
        report_path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/reports/{report_id}")
async def get_report(
    report_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer", "reviewer", "administrator")),
):
    result = await db.execute(select(CommitteeReport).where(CommitteeReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    await ensure_committee_scope(db, current_user, report.bill_ref)
    entries_result = await db.execute(select(ReportEntry).where(ReportEntry.report_ref == report.id))
    return {"report": report_to_dict(report), "entries": [to_dict(entry) for entry in entries_result.scalars().all()]}


@router.put("/reports/{report_id}/entries/{entry_id}")
async def update_report_entry(
    report_id: UUID,
    entry_id: UUID,
    payload: ReportEntryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer", "reviewer", "moderator", "administrator")),
):
    allowed_treatments = {"adopted", "amended", "rejected with reasons", "not addressed"}
    if payload.treatment not in allowed_treatments:
        raise HTTPException(status_code=422, detail="Unsupported treatment")
    result = await db.execute(select(ReportEntry).where(ReportEntry.id == entry_id, ReportEntry.report_ref == report_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Report entry not found")
    entry_bill = (await db.execute(select(CommitteeReport.bill_ref).where(CommitteeReport.id == report_id))).scalar_one_or_none()
    await ensure_committee_scope(db, current_user, entry_bill)
    if payload.treatment == "rejected with reasons" and not (payload.stated_reason or entry.stated_reason or "").strip():
        raise HTTPException(status_code=422, detail="A reason from the committee report is required for this outcome")
    entry.treatment = payload.treatment
    entry.stated_reason = payload.stated_reason
    outcome_change = await record_audit(db, entity_type="report_entry", entity_id=entry.id, action="updated", actor_id=current_user.id, details={"treatment": payload.treatment, "stated_reason": payload.stated_reason})
    await db.commit()
    await db.refresh(entry)
    matches_result = await db.execute(select(SubmissionMatch).where(
        SubmissionMatch.report_entry_ref == entry.id,
        SubmissionMatch.reviewer_decision == "confirmed",
    ))
    for match in matches_result.scalars().all():
        receipt_result = await db.execute(select(ParticipationReceipt).where(ParticipationReceipt.id == match.receipt_ref))
        receipt = receipt_result.scalar_one_or_none()
        if receipt:
            await notification_service.notify_receipt_event(
                db, receipt, f"entry:{entry.id}:change:{outcome_change.id}:receipt:{receipt.id}",
                "outcome_updated", {"treatment": entry.treatment, "reason": entry.stated_reason or ""},
            )
    return {"entry": to_dict(entry)}


@router.put("/reports/{report_id}/verify")
async def verify_report(
    report_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer", "administrator")),
):
    result = await db.execute(select(CommitteeReport).where(CommitteeReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    await ensure_committee_scope(db, current_user, report.bill_ref)
    report.extraction_status = "verified"
    await record_audit(db, entity_type="committee_report", entity_id=report.id, action="verified", actor_id=current_user.id, details={})
    await db.commit()
    await db.refresh(report)
    return {"report": report_to_dict(report)}


@router.post("/reports/{bill_ref}/generate-matches")
async def generate_match_proposals(
    bill_ref: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer", "reviewer", "administrator")),
):
    result = await db.execute(select(LegislativeItem.id).where(LegislativeItem.id == bill_ref))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    await ensure_committee_scope(db, current_user, bill_ref)
    matches = await linking_service.propose_matches(db, bill_ref, use_llm=True)
    return {"matches": [to_dict(match) for match in matches]}


@router.post("/reports/{report_id}/retry-extraction")
async def retry_committee_report_extraction(
    report_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    report_result = await db.execute(select(CommitteeReport).where(CommitteeReport.id == report_id))
    report = report_result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Committee report not found")
    if not report.source_url:
        raise HTTPException(status_code=422, detail="This report has no linked source PDF to re-extract")
    existing_entries = await db.execute(
        select(ReportEntry.id).where(ReportEntry.report_ref == report.id).limit(1)
    )
    if existing_entries.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="This report already has extracted entries")

    report.extraction_status = "pending"
    report.ocr_used = False
    await db.commit()
    extracted_reports = await ingestion_service.extract_pending_linked_reports(
        db, report_id=report.id
    )
    entry_result = await db.execute(select(ReportEntry).where(ReportEntry.report_ref == report.id))
    entries = list(entry_result.scalars().all())
    matches = []
    if entries and report.bill_ref:
        matches = await linking_service.propose_matches(db, report.bill_ref, use_llm=True)
    await db.refresh(report)
    return {
        "report": report_to_dict(report),
        "reports_extracted": extracted_reports,
        "entries_extracted": len(entries),
        "matches": [to_dict(match) for match in matches],
    }


@router.get("/matches/confirmed")
async def get_confirmed_matches(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SubmissionMatch).where(SubmissionMatch.reviewer_decision == "confirmed")
    )
    return {"matches": [to_dict(match, exclude={"reviewer_id"}) for match in result.scalars().all()]}


# ============ Profiles ============

# user_id / verifier_id are internal links to user accounts, so they are
# left out of the public listing.
PROFILE_PUBLIC_EXCLUDE = {"user_id", "verifier_id"}


@router.get("/profiles")
async def list_profiles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RepresentativeProfile))
    profiles = result.scalars().all()
    return {"profiles": [to_dict(p, exclude=PROFILE_PUBLIC_EXCLUDE) for p in profiles]}


@router.get("/profiles/{profile_id}")
async def get_profile(profile_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RepresentativeProfile).where(RepresentativeProfile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"profile": to_dict(profile, exclude=PROFILE_PUBLIC_EXCLUDE)}


@router.post("/profiles/{profile_id}/claim")
async def claim_profile(
    profile_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer")),
):
    result = await db.execute(
        select(RepresentativeProfile).where(
            RepresentativeProfile.id == profile_id,
            RepresentativeProfile.verification_status == "unclaimed",
            RepresentativeProfile.user_id.is_(None),
        )
    )
    profile = result.scalar_one_or_none()

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found or already claimed")

    profile.user_id = current_user.id
    await record_audit(db, entity_type="representative_profile", entity_id=profile.id, action="claimed", actor_id=current_user.id, details={})
    await db.commit()

    return {"profile": to_dict(profile, exclude=PROFILE_PUBLIC_EXCLUDE)}


@router.post("/profiles/{profile_id}/verify")
async def verify_profile(
    profile_id: UUID,
    # alias keeps the form field named "status" without shadowing fastapi.status
    verification_status: str = Form(..., alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("administrator")),
):
    result = await db.execute(
        select(RepresentativeProfile).where(RepresentativeProfile.id == profile_id)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    profile.verification_status = verification_status
    profile.verifier_id = current_user.id
    profile.profile_label = "verified"
    await record_audit(db, entity_type="representative_profile", entity_id=profile.id, action="verified", actor_id=current_user.id, details={"status": verification_status})

    await db.commit()

    return {"profile": to_dict(profile)}


# ============ Notices ============

@router.get("/notices")
async def list_notices(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(NoticeRecord))
    notices = result.scalars().all()
    return {"notices": [to_dict(n) for n in notices]}


@router.get("/bills/{bill_id}/documents/{document_index}")
async def open_bill_document(bill_id: UUID, document_index: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LegislativeItem).where(LegislativeItem.id == bill_id, LegislativeItem.is_simulated.is_(False)))
    bill = result.scalar_one_or_none()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    documents = bill.documents if isinstance(bill.documents, list) else []
    if document_index < 0 or document_index >= len(documents) or not isinstance(documents[document_index], dict):
        raise HTTPException(status_code=404, detail="Bill document not found")
    document = documents[document_index]
    if document.get("url"):
        parsed = urlparse(document["url"])
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return RedirectResponse(document["url"])
    storage_ref = document.get("storage_ref")
    filename = Path(storage_ref or "").name
    document_path = storage_service.STORAGE_DIR / filename
    if not filename or not document_path.is_file():
        raise HTTPException(status_code=404, detail="Bill document is unavailable")
    return FileResponse(document_path, media_type=document.get("mime_type") or "application/pdf", filename=document.get("name") or filename)


@router.post("/notices")
async def create_notice(
    bill_ref: str = Form(...),
    institution: str = Form(...),
    notice_date: date = Form(...),
    window_start: date = Form(...),
    window_end: date = Form(...),
    mode: str = Form(...),
    bill_text_accessible: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer", "administrator")),
):
    try:
        bill_id = UUID(bill_ref)
    except ValueError:
        raise HTTPException(status_code=422, detail="Select a live bill from the platform")
    bill_result = await db.execute(
        select(LegislativeItem).where(
            LegislativeItem.id == bill_id,
            LegislativeItem.is_simulated.is_(False),
        )
    )
    bill = bill_result.scalar_one_or_none()
    if not bill:
        raise HTTPException(status_code=422, detail="Select a live bill from the platform")
    await ensure_committee_scope(db, current_user, bill.id)

    institution_name = institution.strip()
    institution_result = await db.execute(
        select(Committee.institution)
        .where(Committee.status == "active")
        .distinct()
    )
    platform_institutions = {row[0].strip() for row in institution_result.all() if row[0]}
    platform_institutions.add((bill.institution or "").strip())
    if institution_name not in platform_institutions:
        raise HTTPException(status_code=422, detail="Select an institution listed on the platform")
    if window_end < window_start:
        raise HTTPException(status_code=422, detail="window_end must not be before window_start")

    notice = NoticeRecord(
        bill_ref=bill_ref,
        institution=institution_name,
        notice_date=notice_date,
        window_start=window_start,
        window_end=window_end,
        mode=mode,
        bill_text_accessible=bill_text_accessible,
    )
    db.add(notice)
    await db.commit()
    await db.refresh(notice)
    receipts_result = await db.execute(current_receipts().where(ParticipationReceipt.legislative_item_id == notice.bill_ref))
    for receipt in receipts_result.scalars().all():
        await notification_service.notify_receipt_event(
            db, receipt, f"notice:{notice.id}:receipt:{receipt.id}:published", "notice_published",
            {"window_start": notice.window_start.isoformat(), "window_end": notice.window_end.isoformat()},
        )

    return {"notice": to_dict(notice)}


@router.put("/notices/{notice_id}")
async def update_notice(
    notice_id: UUID,
    bill_ref: str = Form(...),
    institution: str = Form(...),
    notice_date: date = Form(...),
    window_start: date = Form(...),
    window_end: date = Form(...),
    mode: str = Form(...),
    bill_text_accessible: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer", "administrator")),
):
    notice_result = await db.execute(select(NoticeRecord).where(NoticeRecord.id == notice_id))
    notice = notice_result.scalar_one_or_none()
    if not notice:
        raise HTTPException(status_code=404, detail="Notice record not found")
    await ensure_committee_scope(db, current_user, notice.bill_ref)
    try:
        bill_id = UUID(bill_ref)
    except ValueError:
        raise HTTPException(status_code=422, detail="Select a live bill from the platform")
    bill_result = await db.execute(select(LegislativeItem).where(LegislativeItem.id == bill_id, LegislativeItem.is_simulated.is_(False)))
    bill = bill_result.scalar_one_or_none()
    if not bill:
        raise HTTPException(status_code=422, detail="Select a live bill from the platform")
    await ensure_committee_scope(db, current_user, bill.id)
    institution_name = institution.strip()
    institution_result = await db.execute(select(Committee.institution).where(Committee.status == "active").distinct())
    platform_institutions = {row[0].strip() for row in institution_result.all() if row[0]}
    platform_institutions.add((bill.institution or "").strip())
    if institution_name not in platform_institutions:
        raise HTTPException(status_code=422, detail="Select an institution listed on the platform")
    if window_end < window_start:
        raise HTTPException(status_code=422, detail="window_end must not be before window_start")
    notice.bill_ref = bill_id
    notice.institution = institution_name
    notice.notice_date = notice_date
    notice.window_start = window_start
    notice.window_end = window_end
    notice.mode = mode
    notice.bill_text_accessible = bill_text_accessible
    await db.commit()
    await db.refresh(notice)
    return {"notice": to_dict(notice)}


# ============ Moderation ============

@router.post("/reports/content")
async def report_content(
    content_type: str = Form(...),
    content_id: str = Form(...),
    reason: str = Form(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Citizen-to-citizen moderation reports apply only to another citizen's
    # public submission. Other content types can be added as separate flows.
    if current_user.role != "citizen":
        raise HTTPException(status_code=403, detail="Only citizen accounts can report citizen submissions")
    if content_type != "receipt":
        raise HTTPException(status_code=422, detail="Only citizen submissions can be reported here")
    # Public receipt lookup returns the human-readable public_id, while other
    # app screens may send the internal UUID. Resolve either identifier.
    try:
        receipt_uuid = UUID(content_id)
    except (ValueError, TypeError):
        receipt_uuid = None
    if receipt_uuid is not None:
        receipt = (await db.execute(select(ParticipationReceipt).where(ParticipationReceipt.id == receipt_uuid))).scalar_one_or_none()
    else:
        receipt = await receipt_service.resolve_receipt(db, normalize_public_id(content_id))
    if receipt is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    author_result = await db.execute(select(User).where(User.id == receipt.author_id))
    author = author_result.scalar_one_or_none()
    if author is None or author.role != "citizen":
        raise HTTPException(status_code=422, detail="Only citizen submissions can be reported")
    if receipt.author_id == current_user.id:
        raise HTTPException(status_code=422, detail="You cannot report your own submission")
    if not reason.strip():
        raise HTTPException(status_code=422, detail="A report reason is required")
    existing_result = await db.execute(select(ModerationAction).where(
        ModerationAction.reporter_id == current_user.id,
        ModerationAction.content_type == "receipt",
        ModerationAction.content_id == receipt.id,
        ModerationAction.decision == "pending",
    ))
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="You already have a pending report for this submission")
    action = ModerationAction(
        reporter_id=current_user.id,
        content_type="receipt",
        content_id=receipt.id,
        reason=reason.strip(),
    )
    db.add(action)
    # SQLAlchemy applies the UUID primary-key default during flush. The audit
    # row requires a non-null entity_id, so persist the action first.
    await db.flush()
    await record_audit(db, entity_type="moderation_action", entity_id=action.id, action="reported", actor_id=current_user.id, details={"content_type": content_type, "reason": reason})
    await db.commit()
    await db.refresh(action)

    return {"action": to_dict(action)}


@router.get("/moderation/cases")
async def list_moderation_cases(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    result = await db.execute(select(ModerationAction))
    actions = result.scalars().all()
    return {"cases": [to_dict(a) for a in actions]}


@router.put("/moderation/cases/{case_id}")
async def decide_moderation_case(
    case_id: UUID,
    decision: str = Form(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    if decision not in {"upheld", "dismissed"}:
        raise HTTPException(status_code=422, detail="Decision must be upheld or dismissed")
    result = await db.execute(select(ModerationAction).where(ModerationAction.id == case_id))
    action = result.scalar_one_or_none()
    if action is None:
        raise HTTPException(status_code=404, detail="Moderation case not found")
    if action.decision != "pending":
        raise HTTPException(status_code=409, detail="This moderation case has already been decided")
    action.decision = decision
    action.reviewer_id = current_user.id
    await record_audit(
        db, entity_type="moderation_action", entity_id=action.id,
        action=decision, actor_id=current_user.id,
        details={"decision": decision, "content_type": action.content_type},
    )
    await db.commit()
    await db.refresh(action)
    return {"action": to_dict(action)}


# ============ Exports ============

@router.get("/export/anonymized")
async def export_anonymized(
    db: AsyncSession = Depends(get_db),
):
    """Public, identifier-free outcome data; the former researcher role is unnecessary."""
    receipts_result = await db.execute(current_receipts())
    receipts = receipts_result.scalars().all()

    entries_result = await db.execute(select(ReportEntry))
    entries = entries_result.scalars().all()

    matches_result = await db.execute(
        select(SubmissionMatch).where(
            SubmissionMatch.reviewer_decision == "confirmed"
        )
    )
    matches = matches_result.scalars().all()

    return {
        "receipts": [
            {
                "public_id": r.public_id,
                "legislative_item_id": r.legislative_item_id,
                "clause_ref": r.clause_ref,
                "submission_text": r.submission_text,
                "timestamp": r.timestamp,
                "lodging_status": r.lodging_status,
            }
            for r in receipts
        ],
        "report_entries": [
            {
                "id": e.id,
                "clause_ref": e.clause_ref,
                "extracted_summary": e.extracted_summary,
                "treatment": e.treatment,
                "stated_reason": e.stated_reason,
            }
            for e in entries
        ],
        "confirmed_matches": [
            {
                "receipt_ref": m.receipt_ref,
                "report_entry_ref": m.report_entry_ref,
                "match_method": m.match_method,
                "confidence_score": m.confidence_score,
                "timestamp": m.timestamp,
            }
            for m in matches
        ],
    }
