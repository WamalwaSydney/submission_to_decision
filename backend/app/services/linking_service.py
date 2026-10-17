# Linking Service — deterministic and optional free Gemini-assisted proposals
from typing import List
from rapidfuzz import fuzz
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import ParticipationReceipt, ReportEntry, SubmissionMatch, Message
from app.audit import record_audit
from app.services import llm_matching_service

async def propose_matches(db: AsyncSession, bill_id: str, use_llm: bool = True) -> List[SubmissionMatch]:
    receipt_result = await db.execute(select(ParticipationReceipt).where(ParticipationReceipt.legislative_item_id == bill_id))
    receipts = list(receipt_result.scalars().all())
    entry_result = await db.execute(select(ReportEntry).join(ReportEntry.report).where(ReportEntry.report.has(bill_ref=bill_id)))
    entries = list(entry_result.scalars().all())
    if not receipts:
        return []
    if not entries:
        await _send_automated_feedback(db, receipts, [])
        await db.commit()
        return []

    existing_result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.receipt_ref.in_([r.id for r in receipts])))
    existing_by_receipt = {}
    for match in existing_result.scalars().all():
        existing_by_receipt.setdefault(match.receipt_ref, []).append(match)

    llm_candidates = []
    if use_llm and llm_matching_service.is_configured():
        try:
            llm_candidates = await llm_matching_service.propose_matches(
                [{"id": r.id, "clause_ref": r.clause_ref, "submission_text": r.submission_text} for r in receipts],
                [{"id": e.id, "clause_ref": e.clause_ref, "extracted_summary": e.extracted_summary} for e in entries],
            )
        except Exception:
            # Provider outage or free-tier quota exhaustion must never block ingestion.
            llm_candidates = []

    receipt_by_id = {str(r.id): r for r in receipts}
    entry_by_id = {str(e.id): e for e in entries}
    matches: list[SubmissionMatch] = []
    if llm_candidates:
        for candidate in llm_candidates:
            receipt = receipt_by_id[candidate["receipt_id"]]
            entry = entry_by_id[candidate["entry_id"]]
            existing = existing_by_receipt.get(receipt.id, [])
            if any(m.reviewer_decision == "confirmed" or m.report_entry_ref == entry.id for m in existing):
                continue
            match = SubmissionMatch(
                receipt_ref=receipt.id, report_entry_ref=entry.id, match_method="llm",
                confidence_score=candidate["confidence"],
                explanation=f"Gemini proposal ({candidate['confidence'] * 100:.1f}%): {candidate['explanation']}",
                reviewer_decision="pending",
            )
            db.add(match); matches.append(match)
    else:
        for receipt in receipts:
            existing = existing_by_receipt.get(receipt.id, [])
            if any(m.reviewer_decision == "confirmed" for m in existing):
                continue
            best_match = None; best_score = 0.0; best_method = None; best_explanation = ""
            for entry in entries:
                if receipt.clause_ref and entry.clause_ref and receipt.clause_ref.lower() == entry.clause_ref.lower():
                    score, method = 0.95, "clause"
                    explanation = f"Exact clause reference match: both reference {receipt.clause_ref}"
                else:
                    similarity = fuzz.token_sort_ratio(receipt.submission_text.lower(), entry.extracted_summary.lower())
                    score, method = similarity / 100.0, "text-similarity"
                    explanation = f"Text similarity proposal ({score * 100:.1f}%): submission discusses '{receipt.submission_text[:50]}...' and report entry '{entry.extracted_summary[:50]}...'."
                if score >= 0.30 and score > best_score:
                    best_score, best_method, best_explanation, best_match = score, method, explanation, entry
            if best_match and not any(m.report_entry_ref == best_match.id for m in existing):
                match = SubmissionMatch(receipt_ref=receipt.id, report_entry_ref=best_match.id, match_method=best_method,
                                         confidence_score=best_score, explanation=best_explanation, reviewer_decision="pending")
                db.add(match); matches.append(match)
    await db.commit()
    await _send_automated_feedback(db, receipts, entries)
    await db.commit()
    return matches

async def _send_automated_feedback(db: AsyncSession, receipts: list[ParticipationReceipt], entries: list[ReportEntry]) -> None:
    """Send one matching alert and, when available, one final outcome alert per receipt."""
    if not receipts:
        return
    receipt_ids = [r.id for r in receipts]
    existing_result = await db.execute(select(Message).where(
        Message.receipt_id.in_(receipt_ids),
        Message.message_type.in_(["automated_match_feedback", "automated_outcome_feedback"]),
    ))
    existing = {(m.receipt_id, m.message_type) for m in existing_result.scalars().all()}
    match_result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.receipt_ref.in_(receipt_ids)))
    by_receipt: dict = {}
    for match in match_result.scalars().all():
        if match.receipt_ref not in by_receipt or match.confidence_score > by_receipt[match.receipt_ref].confidence_score:
            by_receipt[match.receipt_ref] = match
    entry_by_id = {e.id: e for e in entries}
    for receipt in receipts:
        match = by_receipt.get(receipt.id)
        entry = entry_by_id.get(match.report_entry_ref) if match else None
        final = bool(match and match.reviewer_decision == "confirmed" and entry and entry.treatment in {"adopted", "amended", "rejected with reasons", "not addressed"})
        message_type = "automated_outcome_feedback" if final else "automated_match_feedback"
        if (receipt.id, message_type) in existing:
            continue
        if not match:
            subject = "Automated submission matching alert"
            body = ("The automated comparison of your submission against the available committee report is complete. "
                    "No report entry met the minimum confidence threshold, so the submission could not be linked to a recorded committee outcome. "
                    "This does not prove that the committee ignored your view; it means no defensible textual or clause match was found.")
        elif final:
            percentage = match.confidence_score * 100
            reason = entry.stated_reason or "The committee did not publish a specific reason in the extracted report entry."
            subject = f"Submission outcome alert — {percentage:.1f}% match confidence"
            body = (f"The automated traceability review found a {percentage:.1f}% match between your submission and a committee report entry. "
                    f"The recorded treatment is: {entry.treatment}. Committee explanation: {reason} "
                    "This alert reports the committee record; it is not an AI decision about the merits of your view.")
        else:
            percentage = match.confidence_score * 100
            subject = f"Submission matching alert — {percentage:.1f}% proposed confidence"
            body = (f"The automated comparison found a proposed {percentage:.1f}% match to a committee report entry. "
                    "A moderator must still confirm or reject this proposal, so no final outcome has been assigned yet. "
                    f"Matching explanation: {match.explanation}")
        db.add(Message(sender_id=None, recipient_user_id=receipt.author_id, bill_id=receipt.legislative_item_id,
                       receipt_id=receipt.id, subject=subject, body=body, message_type=message_type,
                       sender_type="system"))
        await record_audit(db, entity_type="message", entity_id=receipt.id, action="automated_feedback_queued",
                           actor_id=None, details={"message_type": message_type, "confidence_score": match.confidence_score if match else None})

async def _notify_for_match(db: AsyncSession, match: SubmissionMatch) -> None:
    receipt_result = await db.execute(select(ParticipationReceipt).where(ParticipationReceipt.id == match.receipt_ref))
    receipt = receipt_result.scalar_one_or_none()
    entry_result = await db.execute(select(ReportEntry).where(ReportEntry.id == match.report_entry_ref))
    entry = entry_result.scalar_one_or_none()
    if receipt:
        await _send_automated_feedback(db, [receipt], [entry] if entry else [])
        await db.commit()

async def get_pending_matches(db: AsyncSession) -> List[SubmissionMatch]:
    result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.reviewer_decision == "pending"))
    return list(result.scalars().all())

async def confirm_match(db: AsyncSession, match_id: str, reviewer_id: str) -> SubmissionMatch:
    result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.id == match_id))
    match = result.scalar_one_or_none()
    if not match: raise ValueError("Match not found")
    match.reviewer_decision = "confirmed"; match.reviewer_id = reviewer_id
    await record_audit(db, entity_type="submission_match", entity_id=match.id, action="confirmed", actor_id=reviewer_id, details={"decision": "confirmed"})
    await db.commit(); await _notify_for_match(db, match); await db.refresh(match); return match

async def reject_match(db: AsyncSession, match_id: str, reviewer_id: str) -> SubmissionMatch:
    result = await db.execute(select(SubmissionMatch).where(SubmissionMatch.id == match_id))
    match = result.scalar_one_or_none()
    if not match: raise ValueError("Match not found")
    match.reviewer_decision = "rejected"; match.reviewer_id = reviewer_id
    await record_audit(db, entity_type="submission_match", entity_id=match.id, action="rejected", actor_id=reviewer_id, details={"decision": "rejected"})
    await db.commit(); await _notify_for_match(db, match); await db.refresh(match); return match
