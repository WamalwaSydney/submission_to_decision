# Linking Service — Match proposals between receipts and report entries

from typing import List
from rapidfuzz import fuzz
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import ParticipationReceipt, ReportEntry, SubmissionMatch, LegislativeItem

async def propose_matches(
    db: AsyncSession,
    bill_id: str
) -> List[SubmissionMatch]:
    """Propose matches between receipts and report entries for a bill."""
    
    # Fetch receipts for this bill
    receipt_result = await db.execute(
        select(ParticipationReceipt).where(
            ParticipationReceipt.legislative_item_id == bill_id
        )
    )
    receipts = receipt_result.scalars().all()
    
    # Fetch report entries for this bill's reports
    entry_result = await db.execute(
        select(ReportEntry).join(
            ReportEntry.report
        ).where(
            ReportEntry.report.has(bill_ref=bill_id)
        )
    )
    entries = entry_result.scalars().all()
    
    matches = []
    
    for receipt in receipts:
        # Skip if already has a confirmed match
        existing = await db.execute(
            select(SubmissionMatch).where(
                SubmissionMatch.receipt_ref == receipt.id,
                SubmissionMatch.reviewer_decision == "confirmed"
            )
        )
        if existing.first():
            continue
        
        best_match = None
        best_score = 0.0
        best_method = None
        best_explanation = ""
        
        for entry in entries:
            # Method 1: Clause reference match
            if receipt.clause_ref and entry.clause_ref:
                if receipt.clause_ref.lower() == entry.clause_ref.lower():
                    score = 0.95
                    method = "clause"
                    explanation = f"Exact clause reference match: both reference {receipt.clause_ref}"
                    
                    if score > best_score:
                        best_score = score
                        best_method = method
                        best_explanation = explanation
                        best_match = entry
                    continue
            
            # Method 2: Text similarity
            similarity = fuzz.token_sort_ratio(
                receipt.submission_text.lower(),
                entry.extracted_summary.lower()
            )
            score = similarity / 100.0
            
            if score >= 0.3 and score > best_score:
                best_score = score
                best_method = "text-similarity"
                best_explanation = f"Text similarity: submission discusses '{receipt.submission_text[:50]}...' which matches report entry about '{entry.extracted_summary[:50]}...'. Similarity score: {similarity}%."
                best_match = entry
        
        # Create match if found
        if best_match and best_score >= 0.3:
            match = SubmissionMatch(
                receipt_ref=receipt.id,
                report_entry_ref=best_match.id,
                match_method=best_method,
                confidence_score=best_score,
                explanation=best_explanation,
                reviewer_decision="pending"
            )
            db.add(match)
            matches.append(match)
    
    await db.commit()
    return matches

async def get_pending_matches(db: AsyncSession) -> List[SubmissionMatch]:
    """Get all pending match reviews."""
    result = await db.execute(
        select(SubmissionMatch).where(
            SubmissionMatch.reviewer_decision == "pending"
        )
    )
    return result.scalars().all()

async def confirm_match(
    db: AsyncSession,
    match_id: str,
    reviewer_id: str
) -> SubmissionMatch:
    """Confirm a proposed match."""
    result = await db.execute(
        select(SubmissionMatch).where(SubmissionMatch.id == match_id)
    )
    match = result.scalar_one_or_none()
    
    if not match:
        raise ValueError("Match not found")
    
    match.reviewer_decision = "confirmed"
    match.reviewer_id = reviewer_id
    
    await db.commit()
    await db.refresh(match)
    
    return match

async def reject_match(
    db: AsyncSession,
    match_id: str,
    reviewer_id: str
) -> SubmissionMatch:
    """Reject a proposed match."""
    result = await db.execute(
        select(SubmissionMatch).where(SubmissionMatch.id == match_id)
    )
    match = result.scalar_one_or_none()
    
    if not match:
        raise ValueError("Match not found")
    
    match.reviewer_decision = "rejected"
    match.reviewer_id = reviewer_id
    
    await db.commit()
    await db.refresh(match)
    
    return match
