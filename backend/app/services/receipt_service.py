# Receipt Service — Hash chain management

import hashlib
import json
from datetime import datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.models import ParticipationReceipt, AuditLog

GENESIS_HASH = "0" * 64

def canonical_json(obj: dict) -> str:
    """Deterministic JSON serialization for hashing."""
    return json.dumps(obj, sort_keys=True, separators=(',', ':'))

def compute_receipt_hash(receipt_data: dict) -> str:
    """Compute SHA-256 hash for a receipt."""
    content = canonical_json({
        "receipt_id": str(receipt_data["id"]),
        "author_id": str(receipt_data["author_id"]),
        "legislative_item_id": str(receipt_data["legislative_item_id"]),
        "clause_ref": receipt_data.get("clause_ref"),
        "submission_text": receipt_data["submission_text"],
        "timestamp": receipt_data["timestamp"].isoformat(),
        "previous_hash": receipt_data["previous_hash"],
    })
    return hashlib.sha256(content.encode()).hexdigest()

async def get_chain_head(db: AsyncSession) -> str:
    """Get the hash of the most recent receipt (chain head)."""
    result = await db.execute(
        text("SELECT hash FROM participation_receipts ORDER BY timestamp DESC LIMIT 1")
    )
    row = result.first()
    return row[0] if row else GENESIS_HASH

async def create_receipt(
    db: AsyncSession,
    author_id: str,
    legislative_item_id: str,
    clause_ref: Optional[str],
    submission_text: str,
    public_id: str,
    show_name: bool = False,
    author_name: Optional[str] = None
) -> ParticipationReceipt:
    """Create a new receipt with proper hash chaining."""
    # Get chain head
    previous_hash = await get_chain_head(db)
    
    # Create receipt
    timestamp = datetime.utcnow()
    receipt = ParticipationReceipt(
        public_id=public_id,
        author_id=author_id,
        legislative_item_id=legislative_item_id,
        clause_ref=clause_ref,
        submission_text=submission_text,
        timestamp=timestamp,
        previous_hash=previous_hash,
        lodging_status="pending",
        author_name_public=author_name if show_name else None
    )
    
    # Compute hash
    receipt.hash = compute_receipt_hash({
        "id": receipt.id,
        "author_id": receipt.author_id,
        "legislative_item_id": receipt.legislative_item_id,
        "clause_ref": receipt.clause_ref,
        "submission_text": receipt.submission_text,
        "timestamp": receipt.timestamp,
        "previous_hash": receipt.previous_hash,
    })
    
    # Save
    db.add(receipt)
    
    # Audit log
    audit = AuditLog(
        entity_type="receipt",
        entity_id=receipt.id,
        action="created",
        details=f"Receipt {public_id} issued for {legislative_item_id}"
    )
    db.add(audit)
    
    await db.commit()
    await db.refresh(receipt)
    
    return receipt

async def verify_chain(db: AsyncSession) -> dict:
    """Verify the entire hash chain integrity."""
    result = await db.execute(
        text("SELECT * FROM participation_receipts ORDER BY timestamp ASC")
    )
    receipts = result.fetchall()
    
    details = []
    first_broken = None
    
    for i, row in enumerate(receipts):
        expected_previous = GENESIS_HASH if i == 0 else receipts[i-1].hash
        
        # Recompute hash
        expected_hash = compute_receipt_hash({
            "id": row.id,
            "author_id": row.author_id,
            "legislative_item_id": row.legislative_item_id,
            "clause_ref": row.clause_ref,
            "submission_text": row.submission_text,
            "timestamp": row.timestamp,
            "previous_hash": expected_previous,
        })
        
        valid = row.hash == expected_hash and row.previous_hash == expected_previous
        
        details.append({
            "index": i,
            "receipt_id": row.public_id,
            "valid": valid,
            "expected_hash": expected_hash,
            "actual_hash": row.hash,
        })
        
        if not valid and first_broken is None:
            first_broken = i
    
    return {
        "valid": first_broken is None,
        "total_checked": len(receipts),
        "first_broken_index": first_broken,
        "details": details,
    }
