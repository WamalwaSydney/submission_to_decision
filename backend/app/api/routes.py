# API Routes — All REST endpoints

import os
import random
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional
from uuid import UUID, uuid4
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select, inspect as sa_inspect
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session
from app.auth import get_current_user, require_role, verify_password, get_password_hash, create_access_token
from app.models import (
    User, Committee, LegislativeItem, ParticipationReceipt, Message,
    CommitteeReport, ReportEntry, SubmissionMatch, RepresentativeProfile, NoticeRecord,
    ModerationAction,
)
from app.services import receipt_service, linking_service, ingestion_service, storage_service, notification_service
from app.audit import record_audit

router = APIRouter()
log = logging.getLogger(__name__)
_scheduled_report_bills: set[str] = set()


async def _extract_and_match_bill_reports(bill_id: UUID) -> None:
    key = str(bill_id)
    try:
        async with async_session() as session:
            await ingestion_service.extract_pending_linked_reports(session, bill_id)
            await linking_service.propose_matches(session, bill_id, use_llm=True)
    except Exception:
        log.exception("Background report extraction/matching failed for bill %s", bill_id)
    finally:
        _scheduled_report_bills.discard(key)


async def _extract_and_match_uploaded_report(report_id: UUID, bill_id: UUID) -> None:
    """Run slow OCR after the upload response has been sent to the client."""
    try:
        async with async_session() as session:
            await ingestion_service.process_uploaded_report(report_id)
            await linking_service.propose_matches(session, bill_id, use_llm=True)
    except Exception:
        log.exception("Background upload extraction/matching failed for report %s", report_id)


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str = "citizen"
    committee_id: Optional[UUID] = None
    notification_language: str = "en"


class CommitteeCreate(BaseModel):
    name: str
    institution: str
    description: Optional[str] = None
    contact_email: Optional[str] = None
    account_name: str
    account_email: str
    account_password: str


class CommitteeOfficerApproval(BaseModel):
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
    }


# ============ Authentication ============

@router.post("/auth/login")
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email.strip().lower()))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.status != "active":
        if user.status == "pending_approval":
            raise HTTPException(status_code=403, detail="Committee access request is pending administrator approval")
        raise HTTPException(status_code=403, detail="Account is not active")
    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@router.post("/auth/register")
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    allowed_roles = {"citizen", "committee_officer"}
    if payload.role not in allowed_roles:
        raise HTTPException(status_code=400, detail="Unsupported account role")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
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
    await db.commit()
    await db.refresh(user)
    if payload.role == "committee_officer":
        return {
            "status": "pending_approval",
            "message": f"Your request to access {committee.name} has been sent to the platform administrator. You can sign in after approval.",
        }
    token = create_access_token({"sub": str(user.id)})
    response = {"access_token": token, "token_type": "bearer", "user": public_user(user)}
    return response


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
        raise HTTPException(status_code=404, detail="Committee officer request not found")
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


PUBLIC_RECEIPT_EXCLUDE = {"author_id"}


# ============ Committees ============

@router.get("/committees")
async def list_committees(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Committee).where(Committee.status == "active").order_by(Committee.name.asc()))
    return {"committees": [to_dict(c) for c in result.scalars().all()]}

@router.post("/committees")
async def create_committee(payload: CommitteeCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_role("administrator"))):
    if len(payload.account_password) < 8:
        raise HTTPException(status_code=422, detail="Committee account password must be at least 8 characters")
    existing = await db.execute(select(User).where(User.email == payload.account_email.strip().lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Committee account email already exists")
    committee = Committee(name=payload.name.strip(), institution=payload.institution.strip(), description=payload.description, contact_email=payload.contact_email, created_by=current_user.id)
    db.add(committee); await db.flush()
    account = User(name=payload.account_name.strip(), email=payload.account_email.strip().lower(), role="committee_officer", password_hash=get_password_hash(payload.account_password), committee_id=committee.id, status="active")
    db.add(account)
    await record_audit(db, entity_type="committee", entity_id=committee.id, action="created", actor_id=current_user.id, details={"name": committee.name, "institution": committee.institution})
    await db.commit(); await db.refresh(committee)
    return {"committee": to_dict(committee), "account": public_user(account)}

@router.get("/committees/me/bills")
async def committee_bills(db: AsyncSession = Depends(get_db), current_user: User = Depends(require_role("committee_officer"))):
    result = await db.execute(select(LegislativeItem).where(LegislativeItem.committee_id == current_user.committee_id).order_by(LegislativeItem.source_updated_at.desc().nullslast(), LegislativeItem.title.asc()))
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
        raise HTTPException(status_code=409, detail="Committee account is not linked to a committee")
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
    query = select(LegislativeItem)

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

    return {"bills": [to_dict(b) for b in bills]}


@router.get("/bills/{bill_id}")
async def get_bill(bill_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(LegislativeItem).where(LegislativeItem.id == bill_id)
    )
    bill = result.scalar_one_or_none()

    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    receipts_result = await db.execute(
        select(ParticipationReceipt).where(
            ParticipationReceipt.legislative_item_id == bill_id
        )
    )
    receipts = receipts_result.scalars().all()

    outcome_counts = {
        "awaiting committee report": 0,
        "adopted": 0,
        "amended": 0,
        "rejected with reasons": 0,
        "not addressed": 0,
    }

    for receipt in receipts:
        match_result = await db.execute(
            select(SubmissionMatch).where(
                SubmissionMatch.receipt_ref == receipt.id,
                SubmissionMatch.reviewer_decision == "confirmed",
            )
        )
        match = match_result.scalars().first()

        entry = None
        if match:
            entry_result = await db.execute(
                select(ReportEntry).where(ReportEntry.id == match.report_entry_ref)
            )
            entry = entry_result.scalar_one_or_none()

        if entry:
            outcome_counts[entry.treatment] = outcome_counts.get(entry.treatment, 0) + 1
        else:
            outcome_counts["awaiting committee report"] += 1

    committee = None
    if bill.committee_id:
        c_result = await db.execute(select(Committee).where(Committee.id == bill.committee_id))
        c = c_result.scalar_one_or_none()
        committee = to_dict(c) if c else None
    return {
        **to_dict(bill),
        "committee": committee,
        "outcome_counts": outcome_counts,
        "total_submissions": len(receipts),
    }


@router.get("/bootstrap")
async def bootstrap(db: AsyncSession = Depends(get_db)):
    """Return the non-secret application data needed by the initial client shell."""
    async def all_rows(model, exclude=frozenset()):
        result = await db.execute(select(model))
        rows = result.scalars().all()
        return [report_to_dict(row) if model is CommitteeReport else to_dict(row, exclude=exclude) for row in rows]

    return {
        "committees": await all_rows(Committee),
        "bills": await all_rows(LegislativeItem),
        "receipts": await all_rows(ParticipationReceipt, exclude=PUBLIC_RECEIPT_EXCLUDE),
        "reports": await all_rows(CommitteeReport),
        "report_entries": await all_rows(ReportEntry),
        "matches": await all_rows(SubmissionMatch),
        "notices": await all_rows(NoticeRecord),
        "profiles": await all_rows(RepresentativeProfile, exclude=PROFILE_PUBLIC_EXCLUDE),
    }


# ============ Public bill flow ============

@router.get("/bills/{bill_id}/flow")
async def bill_flow(
    bill_id: UUID,
    background_tasks: BackgroundTasks,
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
    extraction_pending = any(
        report.source_url and report.extraction_status in {"pending", "extracting"}
        for report in reports
    )
    schedule_key = str(bill.id)
    if extraction_pending and schedule_key not in _scheduled_report_bills:
        _scheduled_report_bills.add(schedule_key)
        background_tasks.add_task(_extract_and_match_bill_reports, bill.id)
    receipt_result = await db.execute(select(ParticipationReceipt).where(ParticipationReceipt.legislative_item_id == bill.id).order_by(ParticipationReceipt.timestamp.asc()))
    submissions = []
    for receipt in receipt_result.scalars().all():
        match_result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.receipt_ref == receipt.id).order_by(SubmissionMatch.confidence_score.desc()))
        match = match_result.scalars().first()
        entry = next((e for e in entries if match and e.id == match.report_entry_ref), None)
        submissions.append({"public_id": receipt.public_id, "timestamp": receipt.timestamp, "clause_ref": receipt.clause_ref, "status": entry.treatment if entry and match and match.reviewer_decision == "confirmed" else "awaiting committee report", "match_percentage": round(match.confidence_score * 100, 1) if match else None, "match_decision": match.reviewer_decision if match else None, "reason": entry.stated_reason if entry and match and match.reviewer_decision == "confirmed" else None})
    return {"bill": to_dict(bill), "flow": [{"stage": h.get("stage"), "date": h.get("date"), "note": h.get("note")} for h in (bill.status_history or [])], "reports": [report_to_dict(r) for r in reports], "report_entries": [to_dict(e) for e in entries], "submissions": submissions}

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

@router.post("/receipts")
async def create_receipt(
    legislative_item_id: str = Form(...),
    clause_ref: Optional[str] = Form(None),
    submission_text: str = Form(...),
    show_name_publicly: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "citizen":
        raise HTTPException(status_code=403, detail="Only citizens can submit views")
    if not submission_text.strip():
        raise HTTPException(status_code=422, detail="submission_text must not be empty")

    recent_cutoff = datetime.utcnow() - timedelta(hours=1)
    recent_result = await db.execute(
        select(ParticipationReceipt.id).where(
            ParticipationReceipt.author_id == current_user.id,
            ParticipationReceipt.timestamp >= recent_cutoff,
        )
    )
    if len(recent_result.scalars().all()) >= 5:
        raise HTTPException(status_code=429, detail="Submission limit reached; try again later")

    try:
        bill_uuid = UUID(legislative_item_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Bill not found")

    bill_result = await db.execute(
        select(LegislativeItem.id).where(LegislativeItem.id == bill_uuid)
    )
    if bill_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Bill not found")

    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    public_id = "RCT-" + "".join(random.choices(chars, k=6))

    receipt = await receipt_service.create_receipt(
        db=db,
        author_id=current_user.id,
        legislative_item_id=bill_uuid,
        clause_ref=clause_ref,
        submission_text=submission_text,
        public_id=public_id,
        show_name=show_name_publicly,
        author_name=current_user.name if show_name_publicly else None,
    )

    # A report may have been ingested before this citizen submitted. Re-run
    # matching on submission so the new receipt enters the moderator queue too.
    match_proposals = await linking_service.propose_matches(db, bill_uuid, use_llm=True)
    receipt_match_proposals = [match for match in match_proposals if match.receipt_ref == receipt.id]
    report_result = await db.execute(
        select(CommitteeReport).where(CommitteeReport.bill_ref == bill_uuid)
    )
    linked_reports = list(report_result.scalars().all())
    report_exists = bool(linked_reports)
    entry_result = await db.execute(
        select(ReportEntry.id)
        .join(CommitteeReport, ReportEntry.report_ref == CommitteeReport.id)
        .where(CommitteeReport.bill_ref == bill_uuid)
        .limit(1)
    )
    report_has_entries = entry_result.scalar_one_or_none() is not None
    bill_reference_result = await db.execute(select(LegislativeItem).where(LegislativeItem.id == bill_uuid))
    bill_record = bill_reference_result.scalar_one_or_none()
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
        (report.bill_year is not None and bill_record and bill_record.bill_year is not None and report.bill_year != bill_record.bill_year)
        or (report.bill_number is not None and bill_record and bill_record.bill_number is not None and report.bill_number != bill_record.bill_number)
        or (report.bill_house and bill_record and bill_record.bill_house and house_key(report.bill_house) != house_key(bill_record.bill_house))
        for report in linked_reports
    )
    if receipt_match_proposals:
        matching_status = "pending_review"
    elif not report_exists:
        matching_status = "submission_triage"
    elif report_reference_mismatch:
        matching_status = "report_reference_mismatch"
    elif not report_has_entries:
        matching_status = "report_extraction_required"
    else:
        matching_status = "already_processed"

    await notification_service.notify_receipt_event(
        db, receipt, f"receipt:{receipt.id}:submitted", "submission_received",
    )
    return {
        "receipt_id": receipt.id,
        "public_id": receipt.public_id,
        "timestamp": receipt.timestamp,
        "status": "awaiting committee report",
        "hash": receipt.hash,
        "previous_hash": receipt.previous_hash,
        "match_proposals": [to_dict(match) for match in receipt_match_proposals],
        "matching_status": matching_status,
    }


# NOTE: /receipts/verify MUST be declared before /receipts/{public_id},
# otherwise "verify" is captured as a public_id.
@router.get("/receipts/verify")
async def verify_chain(db: AsyncSession = Depends(get_db)):
    return await receipt_service.verify_chain(db)


@router.get("/receipts/my")
async def my_receipts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ParticipationReceipt).where(ParticipationReceipt.author_id == current_user.id)
    )
    return {"receipts": [to_dict(receipt) for receipt in result.scalars().all()]}


@router.get("/receipts/review-queue")
async def review_queue_receipts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    result = await db.execute(
        select(ParticipationReceipt).order_by(ParticipationReceipt.timestamp.desc())
    )
    # Moderators need submission content and receipt identifiers for review, but
    # author account IDs are internal and must not be exposed in this queue.
    return {"receipts": [to_dict(receipt, exclude={"author_id"}) for receipt in result.scalars().all()]}


@router.get("/receipts/{public_id}")
async def get_receipt(public_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ParticipationReceipt).where(
            ParticipationReceipt.public_id == public_id
        )
    )
    receipt = result.scalar_one_or_none()

    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    bill_result = await db.execute(
        select(LegislativeItem).where(LegislativeItem.id == receipt.legislative_item_id)
    )
    bill = bill_result.scalar_one()

    match_result = await db.execute(
        select(SubmissionMatch).where(
            SubmissionMatch.receipt_ref == receipt.id,
            SubmissionMatch.reviewer_decision == "confirmed",
        )
    )
    match = match_result.scalars().first()

    match_data = None
    if match:
        entry_result = await db.execute(
            select(ReportEntry).where(ReportEntry.id == match.report_entry_ref)
        )
        entry = entry_result.scalar_one_or_none()
        if entry:
            match_data = {
                "method": match.match_method,
                "confidence": match.confidence_score,
                "explanation": match.explanation,
                "treatment": entry.treatment,
                "stated_reason": entry.stated_reason,
            }

    return {
        "public_id": receipt.public_id,
        "legislative_item_id": receipt.legislative_item_id,
        "bill_title": bill.title,
        "clause_ref": receipt.clause_ref,
        "submission_text": receipt.submission_text,
        "timestamp": receipt.timestamp,
        "status": match_data["treatment"] if match_data else "awaiting committee report",
        "lodging_status": receipt.lodging_status,
        "hash": receipt.hash,
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer")),
):
    try:
        match = await linking_service.reject_match(db, match_id, current_user.id)
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
    provenance = storage_service.persist_report(content, file.filename or "report.pdf")
    bill_uuid = UUID(bill_ref)
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
    report_receipts = await db.execute(select(ParticipationReceipt).where(ParticipationReceipt.legislative_item_id == report.bill_ref))
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
    entries_result = await db.execute(select(ReportEntry).where(ReportEntry.report_ref == report.id))
    return {"report": report_to_dict(report), "entries": [to_dict(entry) for entry in entries_result.scalars().all()]}


@router.put("/reports/{report_id}/entries/{entry_id}")
async def update_report_entry(
    report_id: UUID,
    entry_id: UUID,
    payload: ReportEntryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("committee_officer", "administrator")),
):
    allowed_treatments = {"adopted", "amended", "rejected with reasons", "not addressed"}
    if payload.treatment not in allowed_treatments:
        raise HTTPException(status_code=422, detail="Unsupported treatment")
    result = await db.execute(select(ReportEntry).where(ReportEntry.id == entry_id, ReportEntry.report_ref == report_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Report entry not found")
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
    if window_end < window_start:
        raise HTTPException(status_code=422, detail="window_end must not be before window_start")

    notice = NoticeRecord(
        bill_ref=bill_ref,
        institution=institution,
        notice_date=notice_date,
        window_start=window_start,
        window_end=window_end,
        mode=mode,
        bill_text_accessible=bill_text_accessible,
    )
    db.add(notice)
    await db.commit()
    await db.refresh(notice)
    receipts_result = await db.execute(select(ParticipationReceipt).where(ParticipationReceipt.legislative_item_id == notice.bill_ref))
    for receipt in receipts_result.scalars().all():
        await notification_service.notify_receipt_event(
            db, receipt, f"notice:{notice.id}:receipt:{receipt.id}:published", "notice_published",
            {"window_start": notice.window_start.isoformat(), "window_end": notice.window_end.isoformat()},
        )

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
    action = ModerationAction(
        reporter_id=current_user.id,
        content_type=content_type,
        content_id=content_id,
        reason=reason,
    )
    db.add(action)
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


# ============ Exports ============

@router.get("/export/anonymized")
async def export_anonymized(
    db: AsyncSession = Depends(get_db),
):
    """Public, identifier-free outcome data; the former researcher role is unnecessary."""
    receipts_result = await db.execute(select(ParticipationReceipt))
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
