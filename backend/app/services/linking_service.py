# Matching proposals and human-confirmed decisions for public submissions.
from typing import List
import hashlib
import logging
from rapidfuzz import fuzz
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import ParticipationReceipt, ReportEntry, SubmissionMatch, CommitteeReport, LegislativeItem
from app.audit import record_audit
from app.services import ingestion_service, llm_matching_service, notification_service

log = logging.getLogger(__name__)


def _house_key(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().casefold()
    if "senate" in normalized:
        return "senate"
    if normalized in {"na", "national assembly"} or "national assembly" in normalized:
        return "na"
    return normalized

async def propose_matches(db: AsyncSession, bill_id: str, use_llm: bool = True) -> List[SubmissionMatch]:
    # Parliament sync stores linked report PDFs as pending records. Extract them
    # on the first automatic matching attempt so link-only reports are usable.
    await ingestion_service.extract_pending_linked_reports(db, bill_id)
    bill_result = await db.execute(select(LegislativeItem).where(LegislativeItem.id == bill_id))
    bill = bill_result.scalar_one_or_none()
    if bill is None:
        return []
    receipt_result = await db.execute(select(ParticipationReceipt).where(ParticipationReceipt.legislative_item_id == bill_id))
    receipts = list(receipt_result.scalars().all())
    entry_result = await db.execute(
        select(ReportEntry, CommitteeReport)
        .join(CommitteeReport, ReportEntry.report_ref == CommitteeReport.id)
        .where(CommitteeReport.bill_ref == bill_id)
    )
    entries = []
    for entry, report in entry_result.all():
        conflicts = []
        if report.bill_house and bill.bill_house and _house_key(report.bill_house) != _house_key(bill.bill_house):
            conflicts.append("house")
        if report.bill_number is not None and bill.bill_number is not None and report.bill_number != bill.bill_number:
            conflicts.append("bill number")
        if report.bill_year is not None and bill.bill_year is not None and report.bill_year != bill.bill_year:
            conflicts.append("bill year")
        if conflicts:
            log.warning(
                "Skipping committee report %s for bill %s because official reference conflicts on %s",
                report.id, bill.id, ", ".join(conflicts),
            )
            continue
        if (entry.extracted_summary or "").strip():
            entries.append(entry)
    if not receipts or not entries:
        return []

    existing_result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.receipt_ref.in_([r.id for r in receipts])))
    existing_by_receipt = {}
    for match in existing_result.scalars().all():
        existing_by_receipt.setdefault(match.receipt_ref, []).append(match)

    # Only score receipts that have never been proposed or decided. This keeps
    # the AI request small and ensures a moderator rejection is not resurrected.
    receipts_to_score = [receipt for receipt in receipts if not existing_by_receipt.get(receipt.id)]
    if not receipts_to_score:
        return []

    llm_candidates = []
    if use_llm and llm_matching_service.is_configured():
        try:
            llm_candidates = await llm_matching_service.propose_matches(
                [{"id": r.id, "clause_ref": r.clause_ref, "submission_text": r.submission_text} for r in receipts_to_score],
                [{"id": e.id, "clause_ref": e.clause_ref, "extracted_summary": e.extracted_summary} for e in entries],
            )
        except Exception:
            # Provider outages must not prevent the deterministic fallback or report processing.
            llm_candidates = []

    receipt_by_id = {str(r.id): r for r in receipts}
    entry_by_id = {str(e.id): e for e in entries}
    llm_by_receipt = {}
    for candidate in llm_candidates:
        if candidate["receipt_id"] in receipt_by_id and candidate["entry_id"] in entry_by_id:
            llm_by_receipt.setdefault(candidate["receipt_id"], candidate)

    matches: list[SubmissionMatch] = []
    for receipt in receipts_to_score:
        existing = existing_by_receipt.get(receipt.id, [])
        # Do not silently resurrect a proposal a moderator already confirmed or
        # rejected, or duplicate one that is still awaiting a decision.
        if existing:
            continue

        candidate = llm_by_receipt.get(str(receipt.id))
        if candidate:
            entry = entry_by_id[candidate["entry_id"]]
            match = SubmissionMatch(
                receipt_ref=receipt.id, report_entry_ref=entry.id, match_method="llm",
                confidence_score=candidate["confidence"],
                explanation=f"Gemini proposal ({candidate['confidence'] * 100:.1f}%): {candidate['explanation']}",
                reviewer_decision="pending", actor_type="automated_system",
            )
            db.add(match)
            matches.append(match)
            continue

        # AI may omit an item when uncertain or fail entirely. Still run the
        # deterministic clause/text scorer for that receipt so AI coverage of
        # other submissions cannot suppress its automatic proposal.
        best_match = None
        best_score = 0.0
        best_method = None
        best_explanation = ""
        for entry in entries:
            if receipt.clause_ref and entry.clause_ref and receipt.clause_ref.strip().lower() == entry.clause_ref.strip().lower():
                score, method = 0.95, "clause"
                explanation = f"Exact clause reference match: both reference {receipt.clause_ref}"
            else:
                similarity = fuzz.token_sort_ratio(receipt.submission_text.lower(), entry.extracted_summary.lower())
                score, method = similarity / 100.0, "text-similarity"
                explanation = f"Text similarity proposal ({score * 100:.1f}%): submission discusses '{receipt.submission_text[:50]}...' and report entry '{entry.extracted_summary[:50]}...' ."
            if best_match is None or score > best_score:
                best_score, best_method, best_explanation, best_match = score, method, explanation, entry
        if best_match:
            if best_score < 0.30:
                best_explanation = (
                    f"Low-confidence fallback proposal ({best_score * 100:.1f}% lexical similarity). "
                    "No clear semantic match was returned; moderator review is required. "
                    f"Top candidate report entry: '{best_match.extracted_summary[:180]}'."
                )
            match = SubmissionMatch(
                receipt_ref=receipt.id, report_entry_ref=best_match.id, match_method=best_method,
                confidence_score=best_score, explanation=best_explanation,
                reviewer_decision="pending", actor_type="automated_system",
            )
            db.add(match)
            matches.append(match)

    await db.commit()
    report_ids = sorted({str(entry.report_ref) for entry in entries})
    report_tag = hashlib.sha256("|".join(report_ids).encode()).hexdigest()[:16]
    for receipt in receipts:
        result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.receipt_ref == receipt.id).order_by(SubmissionMatch.confidence_score.desc()))
        current_matches = list(result.scalars().all())
        pending = next((item for item in current_matches if item.reviewer_decision == "pending"), None)
        if pending:
            await notification_service.notify_receipt_event(
                db, receipt, f"match:{pending.id}:pending", "match_pending",
                {"confidence": round(pending.confidence_score * 100, 1)},
            )
        elif not current_matches:
            await notification_service.notify_receipt_event(
                db, receipt, f"reports:{report_tag}:receipt:{receipt.id}:no-match", "no_match_yet",
            )
    return matches

async def _notify_decision(db: AsyncSession, match: SubmissionMatch, decision: str) -> None:
    receipt_result = await db.execute(select(ParticipationReceipt).where(ParticipationReceipt.id == match.receipt_ref))
    receipt = receipt_result.scalar_one_or_none()
    entry_result = await db.execute(select(ReportEntry).where(ReportEntry.id == match.report_entry_ref))
    entry = entry_result.scalar_one_or_none()
    if not receipt or not entry:
        return
    if decision == "confirmed":
        treatment = entry.treatment
        facts = {"treatment": treatment, "reason": entry.stated_reason or "", "confidence": round(match.confidence_score * 100, 1)}
        key = f"match:{match.id}:confirmed:{treatment}"
        event = "match_confirmed"
    else:
        facts = {}
        key = f"match:{match.id}:rejected"
        event = "match_rejected"
    await notification_service.notify_receipt_event(db, receipt, key, event, facts)

async def get_pending_matches(db: AsyncSession) -> List[SubmissionMatch]:
    result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.reviewer_decision == "pending"))
    return list(result.scalars().all())

async def confirm_match(db: AsyncSession, match_id: str, reviewer_id: str) -> SubmissionMatch:
    result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.id == match_id))
    match = result.scalar_one_or_none()
    if not match:
        raise ValueError("Match not found")
    match.reviewer_decision = "confirmed"
    match.reviewer_id = reviewer_id
    await record_audit(db, entity_type="submission_match", entity_id=match.id, action="confirmed", actor_id=reviewer_id, details={"decision": "confirmed"})
    await db.commit()
    await _notify_decision(db, match, "confirmed")
    await db.refresh(match)
    return match

async def reject_match(db: AsyncSession, match_id: str, reviewer_id: str) -> SubmissionMatch:
    result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.id == match_id))
    match = result.scalar_one_or_none()
    if not match:
        raise ValueError("Match not found")
    match.reviewer_decision = "rejected"
    match.reviewer_id = reviewer_id
    await record_audit(db, entity_type="submission_match", entity_id=match.id, action="rejected", actor_id=reviewer_id, details={"decision": "rejected"})
    await db.commit()
    await _notify_decision(db, match, "rejected")
    await db.refresh(match)
    return match
