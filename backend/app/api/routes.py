# API Routes — All REST endpoints

import os
import random
from datetime import date
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import select, inspect as sa_inspect
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth import get_current_user, require_role, verify_password, get_password_hash, create_access_token
from app.models import (
    User, LegislativeItem, ParticipationReceipt,
    CommitteeReport, ReportEntry, SubmissionMatch, RepresentativeProfile, NoticeRecord,
    ModerationAction,
)
from app.services import receipt_service, linking_service, ingestion_service

router = APIRouter()


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str = "citizen"


def public_user(user: User) -> dict:
    return {
        "id": str(user.id),
        "role": user.role,
        "name": user.name,
        "email": user.email,
        "status": user.status,
        "created_date": user.created_date,
    }


# ============ Authentication ============

@router.post("/auth/login")
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email.strip().lower()))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="Account suspended")
    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@router.post("/auth/register")
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if payload.role not in {"citizen", "representative"}:
        raise HTTPException(status_code=400, detail="Only citizen and representative accounts can self-register")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    email = payload.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An account with that email already exists")
    user = User(name=payload.name.strip(), email=email, role=payload.role, password_hash=get_password_hash(payload.password), status="active")
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


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


# ============ Helpers ============

def to_dict(obj, exclude: set = frozenset()) -> dict:
    """Serialize an ORM object's columns only (no _sa_instance_state, no relationships)."""
    return {
        attr.key: getattr(obj, attr.key)
        for attr in sa_inspect(obj).mapper.column_attrs
        if attr.key not in exclude
    }


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

    return {
        **to_dict(bill),
        "outcome_counts": outcome_counts,
        "total_submissions": len(receipts),
    }


@router.get("/bootstrap")
async def bootstrap(db: AsyncSession = Depends(get_db)):
    """Return the non-secret application data needed by the initial client shell."""
    async def all_rows(model, exclude=frozenset()):
        result = await db.execute(select(model))
        return [to_dict(row, exclude=exclude) for row in result.scalars().all()]

    return {
        "bills": await all_rows(LegislativeItem),
        "receipts": await all_rows(ParticipationReceipt),
        "reports": await all_rows(CommitteeReport),
        "report_entries": await all_rows(ReportEntry),
        "matches": await all_rows(SubmissionMatch),
        "notices": await all_rows(NoticeRecord),
        "profiles": await all_rows(RepresentativeProfile, exclude=PROFILE_PUBLIC_EXCLUDE),
    }


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

    return {
        "receipt_id": receipt.id,
        "public_id": receipt.public_id,
        "timestamp": receipt.timestamp,
        "status": "awaiting committee report",
        "hash": receipt.hash,
        "previous_hash": receipt.previous_hash,
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
    current_user: User = Depends(require_role("moderator")),
):
    matches = await linking_service.get_pending_matches(db)
    return {"matches": matches}


@router.post("/matches/{match_id}/confirm")
async def confirm_match(
    match_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("moderator")),
):
    match = await linking_service.confirm_match(db, match_id, current_user.id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return {"match": match}


@router.post("/matches/{match_id}/reject")
async def reject_match(
    match_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("moderator")),
):
    match = await linking_service.reject_match(db, match_id, current_user.id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return {"match": match}


# ============ Reports ============

@router.post("/reports/upload")
async def upload_report(
    file: UploadFile = File(...),
    bill_ref: str = Form(...),
    institution: str = Form(...),
    date_tabled: str = Form(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("clerk")),
):
    # Never trust the client filename: strip any path and prefix a random id
    safe_name = os.path.basename(file.filename or "upload")
    file_path = f"/tmp/{uuid4().hex}_{safe_name}"

    try:
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        report = await ingestion_service.ingest_report(
            db=db,
            bill_ref=bill_ref,
            institution=institution,
            file_path=file_path,
            date_tabled=date_tabled,
        )
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

    return {
        "report_id": report.id,
        "extraction_status": report.extraction_status,
        "ocr_used": report.ocr_used,
    }


# ============ Profiles ============

# user_id / verifier_id are internal links to user accounts, so they are
# left out of the public listing.
PROFILE_PUBLIC_EXCLUDE = {"user_id", "verifier_id"}


@router.get("/profiles")
async def list_profiles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RepresentativeProfile))
    profiles = result.scalars().all()
    return {"profiles": [to_dict(p, exclude=PROFILE_PUBLIC_EXCLUDE) for p in profiles]}


@router.post("/profiles/{profile_id}/claim")
async def claim_profile(
    profile_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("representative")),
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
    current_user: User = Depends(require_role("clerk", "administrator")),
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
    await db.commit()
    await db.refresh(action)

    return {"action": to_dict(action)}


@router.get("/moderation/cases")
async def list_moderation_cases(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("moderator")),
):
    result = await db.execute(select(ModerationAction))
    actions = result.scalars().all()
    return {"cases": [to_dict(a) for a in actions]}


# ============ Exports ============

@router.get("/export/anonymized")
async def export_anonymized(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("administrator")),
):
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
