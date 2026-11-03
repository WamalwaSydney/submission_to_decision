# Receipt Service — Hash chain management

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
import re
from sqlalchemy import exists, func, select, text
from sqlalchemy.orm import aliased

from app.models import ParticipationReceipt, AuditLog

GENESIS_HASH = "0" * 64
VERSION_RE = re.compile(r"^(?P<stable>.+)-v(?P<revision>\d+)$")


# ---- Versions of a submission (receipts are append-only) -------------------

def stable_id_of(receipt) -> str:
    """The citizen's receipt ID, the same for every version of a submission."""
    return receipt.submission_ref or receipt.public_id


def version_id_of(receipt) -> str:
    """The ID of this exact version: the receipt ID, or "<ID>-v<n>" after an edit."""
    return receipt.public_id


def _stable_expr(model):
    return func.coalesce(model.submission_ref, model.public_id)


def is_current():
    """SQL condition: no later version of the same submission exists."""
    newer = aliased(ParticipationReceipt)
    return ~exists().where(
        _stable_expr(newer) == _stable_expr(ParticipationReceipt),
        newer.revision > ParticipationReceipt.revision,
    )


def current_receipts():
    return select(ParticipationReceipt).where(is_current())


async def resolve_receipt(db: AsyncSession, receipt_id: str) -> Optional[ParticipationReceipt]:
    """Find a receipt by the citizen's ID (its current version) or by "<ID>-v<n>"."""
    match = VERSION_RE.match(receipt_id or "")
    if match:
        stable, revision = match.group("stable"), int(match.group("revision"))
        result = await db.execute(select(ParticipationReceipt).where(
            _stable_expr(ParticipationReceipt) == stable, ParticipationReceipt.revision == revision))
        return result.scalar_one_or_none()
    result = await db.execute(
        select(ParticipationReceipt).where(_stable_expr(ParticipationReceipt) == receipt_id)
        .order_by(ParticipationReceipt.revision.desc()).limit(1))
    return result.scalar_one_or_none()


async def has_newer_version(db: AsyncSession, receipt: ParticipationReceipt) -> bool:
    newer = (await db.execute(select(ParticipationReceipt.id).where(
        _stable_expr(ParticipationReceipt) == stable_id_of(receipt),
        ParticipationReceipt.revision > receipt.revision).limit(1))).scalar_one_or_none()
    return newer is not None

def canonical_json(obj: dict) -> str:
    """Deterministic JSON serialization for hashing."""
    return json.dumps(obj, sort_keys=True, separators=(',', ':'))

def compute_receipt_hash(receipt_data: dict) -> str:
    """Compute SHA-256 hash for a receipt."""
    payload = {
        "receipt_id": str(receipt_data["id"]),
        "author_id": str(receipt_data["author_id"]),
        "legislative_item_id": str(receipt_data["legislative_item_id"]),
        "clause_ref": receipt_data.get("clause_ref"),
        "submission_text": receipt_data["submission_text"],
        "timestamp": receipt_data["timestamp"].isoformat(),
        "previous_hash": receipt_data["previous_hash"],
    }
    # Only receipts with an uploaded document carry this key, so receipts
    # created before document uploads existed keep their original hash.
    if receipt_data.get("attachment_sha256"):
        payload["attachment_sha256"] = receipt_data["attachment_sha256"]
    content = canonical_json(payload)
    return hashlib.sha256(content.encode()).hexdigest()

async def get_chain_head(db: AsyncSession) -> str:
    """Get the hash of the most recent receipt (chain head)."""
    result = await db.execute(
        text("SELECT hash FROM participation_receipts ORDER BY chain_sequence DESC NULLS LAST, timestamp DESC, id DESC LIMIT 1")
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
    author_name: Optional[str] = None,
    attachment: Optional[dict] = None,
    revision: int = 1,
    submission_ref: Optional[str] = None,
) -> ParticipationReceipt:
    """Create a new receipt with proper hash chaining."""
    # Serialize chain-head reads within the current transaction. Without this
    # lock, concurrent submissions could observe the same previous hash and
    # create competing branches.
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('participation_receipts_chain'))"))
    previous_hash = await get_chain_head(db)
    sequence_result = await db.execute(text("SELECT COALESCE(MAX(chain_sequence), 0) + 1 FROM participation_receipts"))
    chain_sequence = int(sequence_result.scalar_one())
    
    # Allocate the primary key before flush so the complete hash payload can
    # be computed before PostgreSQL validates the NOT NULL hash column.
    timestamp = datetime.now(timezone.utc)
    receipt_id = uuid.uuid4()
    hash_payload = {
        "id": receipt_id,
        "author_id": author_id,
        "legislative_item_id": legislative_item_id,
        "clause_ref": clause_ref,
        "submission_text": submission_text,
        "timestamp": timestamp,
        "previous_hash": previous_hash,
        "attachment_sha256": (attachment or {}).get("sha256"),
    }
    receipt = ParticipationReceipt(
        id=receipt_id,
        public_id=public_id,
        author_id=author_id,
        legislative_item_id=legislative_item_id,
        clause_ref=clause_ref,
        submission_text=submission_text,
        timestamp=timestamp,
        previous_hash=previous_hash,
        chain_sequence=chain_sequence,
        hash=compute_receipt_hash(hash_payload),
        lodging_status="pending",
        author_name_public=author_name if show_name else None,
        revision=revision,
        submission_ref=submission_ref,
        attachment_name=(attachment or {}).get("name"),
        attachment_mime_type=(attachment or {}).get("mime_type"),
        attachment_size_bytes=(attachment or {}).get("size_bytes"),
        attachment_sha256=(attachment or {}).get("sha256"),
        attachment_storage_ref=(attachment or {}).get("storage_ref"),
    )
    db.add(receipt)
    await db.flush()
    
    # Audit log
    audit = AuditLog(
        entity_type="receipt",
        entity_id=receipt.id,
        action="created",
        details=f"Receipt {public_id} issued for {legislative_item_id}",
        actor_id=uuid.UUID(str(author_id)) if not isinstance(author_id, uuid.UUID) else author_id,
    )
    db.add(audit)
    
    await db.commit()
    await db.refresh(receipt)
    
    return receipt

def _check_link(row, expected_previous: str, expected_sequence: int, latest_revision: Optional[dict] = None) -> dict:
    """Recompute one receipt's hash and check its link to the receipt before it."""
    hash_payload = {
        "id": row.id,
        "author_id": row.author_id,
        "legislative_item_id": row.legislative_item_id,
        "clause_ref": row.clause_ref,
        "submission_text": row.submission_text,
        "timestamp": row.timestamp,
        "previous_hash": expected_previous,
        "attachment_sha256": getattr(row, "attachment_sha256", None),
    }
    candidates = [compute_receipt_hash(hash_payload)]
    # Older records were hashed with naive UTC datetimes before insertion;
    # PostgreSQL returns those values as timezone-aware UTC. Verify the old
    # canonical representation as a read-only compatibility fallback.
    if row.timestamp.tzinfo is not None:
        candidates.append(compute_receipt_hash({**hash_payload, "timestamp": row.timestamp.replace(tzinfo=None)}))

    content_ok = row.hash in candidates and len(row.hash or "") == 64
    link_ok = row.previous_hash == expected_previous
    sequence_ok = row.chain_sequence == expected_sequence
    problems = []
    if not content_ok:
        problems.append("The receipt's content no longer matches its hash, so it was altered after it was issued or was never hashed correctly.")
    if not link_ok:
        problems.append("The receipt does not point to the receipt before it in the chain.")
    if not sequence_ok:
        problems.append("The receipt is out of order in the chain.")
    return {
        "receipt_id": row.public_id,
        "valid": not problems,
        "content_matches": content_ok,
        "link_matches": link_ok,
        # Show the hash that matched (or the current-format hash when none did).
        "expected_hash": row.hash if content_ok else candidates[0],
        "actual_hash": row.hash,
        "previous_hash": row.previous_hash,
        "expected_previous_hash": expected_previous,
        "sequence": row.chain_sequence,
        "expected_sequence": expected_sequence,
        "timestamp": row.timestamp.isoformat(),
        "superseded": bool(latest_revision and row.revision < latest_revision.get(row.submission_ref or row.public_id, row.revision)),
        "problems": problems,
    }


async def verify_chain(db: AsyncSession) -> dict:
    """Verify every receipt, including earlier versions of edited submissions."""
    result = await db.execute(
        text("SELECT * FROM participation_receipts ORDER BY chain_sequence ASC NULLS LAST, timestamp ASC, id ASC")
    )
    receipts = result.fetchall()
    latest_revision: dict = {}
    for row in receipts:
        key = row.submission_ref or row.public_id
        latest_revision[key] = max(latest_revision.get(key, 0), row.revision or 1)
    details = []
    for i, row in enumerate(receipts):
        expected_previous = GENESIS_HASH if i == 0 else receipts[i - 1].hash
        details.append({"index": i, **_check_link(row, expected_previous, i + 1, latest_revision)})
    broken = [item["index"] for item in details if not item["valid"]]
    return {
        "valid": not broken,
        "total_checked": len(receipts),
        "broken_count": len(broken),
        "first_broken_index": broken[0] if broken else None,
        "head_hash": receipts[-1].hash if receipts else GENESIS_HASH,
        "details": details,
    }


async def verify_receipt(db: AsyncSession, receipt_id: str) -> Optional[dict]:
    """Check one receipt version: its own hash, and that it links to the receipt before it."""
    resolved = await resolve_receipt(db, receipt_id)
    if resolved is None:
        return None
    row = (await db.execute(
        text("SELECT * FROM participation_receipts WHERE id = :id"), {"id": resolved.id}
    )).first()
    if row is None:
        return None
    position = (await db.execute(
        text("SELECT COUNT(*) FROM participation_receipts WHERE chain_sequence < :sequence"), {"sequence": row.chain_sequence}
    )).scalar_one() + 1
    previous = (await db.execute(
        text("SELECT hash FROM participation_receipts WHERE chain_sequence < :sequence ORDER BY chain_sequence DESC LIMIT 1"),
        {"sequence": row.chain_sequence},
    )).first()
    following = (await db.execute(
        text("SELECT previous_hash FROM participation_receipts WHERE chain_sequence > :sequence ORDER BY chain_sequence ASC LIMIT 1"),
        {"sequence": row.chain_sequence},
    )).first()
    newer = await has_newer_version(db, resolved)
    check = _check_link(row, previous[0] if previous else GENESIS_HASH, position,
                        {stable_id_of(resolved): resolved.revision + (1 if newer else 0)})
    # The next receipt must point back at this one, or this one was replaced.
    check["next_links_back"] = following is None or following[0] == row.hash
    if not check["next_links_back"]:
        check["valid"] = False
        check["problems"].append("The next receipt in the chain does not point to this receipt.")
    check["position"] = position
    return check
