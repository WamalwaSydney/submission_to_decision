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

# The chain runs through two tables: platform receipts and the submissions committee reports record. They share
# one sequence and one head, so each link (of either kind) points to the link before it.
CHAIN_LINKS = ("(SELECT id, hash, previous_hash, chain_sequence FROM participation_receipts "
               "UNION ALL SELECT id, hash, previous_hash, chain_sequence FROM report_records) AS links")


async def get_chain_head(db: AsyncSession) -> str:
    """Get the hash of the most recent link in the chain (chain head)."""
    row = (await db.execute(text(f"SELECT hash FROM {CHAIN_LINKS} ORDER BY chain_sequence DESC LIMIT 1"))).first()
    return row[0] if row else GENESIS_HASH


async def next_chain_sequence(db: AsyncSession) -> int:
    return int((await db.execute(text(f"SELECT COALESCE(MAX(chain_sequence), 0) + 1 FROM {CHAIN_LINKS}"))).scalar_one())


async def lock_chain(db: AsyncSession) -> None:
    """Serialize chain-head reads within the current transaction, so two writers never extend the same head."""
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('participation_receipts_chain'))"))


def compute_record_hash(record) -> str:
    """SHA-256 of a report record: what the report says about one submission, and the link before it."""
    payload = {
        "record_id": str(record["id"]),
        "legislative_item_id": str(record["legislative_item_id"]),
        "report_id": str(record["report_ref"]),
        "report_sha256": record.get("report_sha256"),
        "entry_key": record["entry_key"],
        "source": record["source"],
        "stakeholder": record.get("stakeholder"),
        "clause_ref": record.get("clause_ref"),
        "issue": record["issue"],
        "decision": record["decision"],
        "reason": record.get("reason"),
        "recorded_at": record["recorded_at"].isoformat(),
        "previous_hash": record["previous_hash"],
    }
    return hashlib.sha256(canonical_json(payload).encode()).hexdigest()

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
    await lock_chain(db)
    previous_hash = await get_chain_head(db)
    chain_sequence = await next_chain_sequence(db)
    
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
        "kind": "receipt",
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


def _check_record_link(row, expected_previous: str, expected_sequence: int) -> dict:
    """Recompute one report record's hash and check its link to the link before it."""
    expected_hash = compute_record_hash({**row._mapping, "previous_hash": expected_previous})
    content_ok = row.hash == expected_hash
    link_ok = row.previous_hash == expected_previous
    sequence_ok = row.chain_sequence == expected_sequence
    problems = []
    if not content_ok:
        problems.append("The record no longer matches its hash, so what it says the report records was changed after it was sealed.")
    if not link_ok:
        problems.append("The record does not point to the link before it in the chain.")
    if not sequence_ok:
        problems.append("The record is out of order in the chain.")
    return {
        "kind": "record",
        "receipt_id": row.public_id,
        "valid": not problems,
        "content_matches": content_ok,
        "link_matches": link_ok,
        "expected_hash": expected_hash,
        "actual_hash": row.hash,
        "previous_hash": row.previous_hash,
        "expected_previous_hash": expected_previous,
        "sequence": row.chain_sequence,
        "expected_sequence": expected_sequence,
        "timestamp": row.recorded_at.isoformat(),
        "superseded": False,
        "problems": problems,
    }


async def verify_chain(db: AsyncSession) -> dict:
    """Verify every link: platform receipts (including earlier versions of edited submissions) and report records."""
    receipts = (await db.execute(
        text("SELECT * FROM participation_receipts ORDER BY chain_sequence ASC NULLS LAST, timestamp ASC, id ASC")
    )).fetchall()
    records = (await db.execute(text("SELECT * FROM report_records ORDER BY chain_sequence ASC"))).fetchall()
    latest_revision: dict = {}
    for row in receipts:
        key = row.submission_ref or row.public_id
        latest_revision[key] = max(latest_revision.get(key, 0), row.revision or 1)
    record_ids = {row.id for row in records}
    links = sorted([*receipts, *records], key=lambda row: (row.chain_sequence is None, row.chain_sequence or 0))
    details = []
    for i, row in enumerate(links):
        expected_previous = GENESIS_HASH if i == 0 else links[i - 1].hash
        if row.id in record_ids:
            check = _check_record_link(row, expected_previous, i + 1)
        else:
            check = _check_link(row, expected_previous, i + 1, latest_revision)
        details.append({"index": i, **check})
    broken = [item["index"] for item in details if not item["valid"]]
    return {
        "valid": not broken,
        "total_checked": len(links),
        "receipts_checked": len(receipts),
        "records_checked": len(records),
        "broken_count": len(broken),
        "first_broken_index": broken[0] if broken else None,
        "head_hash": links[-1].hash if links else GENESIS_HASH,
        "details": details,
    }


async def _neighbours(db: AsyncSession, sequence: int):
    """A link's position in the chain, the hash of the link before it, and what the link after it points back to."""
    position = (await db.execute(text(f"SELECT COUNT(*) FROM {CHAIN_LINKS} WHERE chain_sequence < :s"), {"s": sequence})).scalar_one() + 1
    previous = (await db.execute(text(f"SELECT hash FROM {CHAIN_LINKS} WHERE chain_sequence < :s ORDER BY chain_sequence DESC LIMIT 1"), {"s": sequence})).first()
    following = (await db.execute(text(f"SELECT previous_hash FROM {CHAIN_LINKS} WHERE chain_sequence > :s ORDER BY chain_sequence ASC LIMIT 1"), {"s": sequence})).first()
    return position, (previous[0] if previous else None), (following[0] if following else None)


async def verify_record(db: AsyncSession, public_id: str) -> Optional[dict]:
    """Check one report record: its own hash, and its links to the chain on both sides."""
    row = (await db.execute(text("SELECT * FROM report_records WHERE public_id = :p"), {"p": public_id.strip().upper()})).first()
    if row is None:
        return None
    position, previous, following = await _neighbours(db, row.chain_sequence)
    check = _check_record_link(row, previous or GENESIS_HASH, position)
    check["next_links_back"] = following is None or following == row.hash
    if not check["next_links_back"]:
        check["valid"] = False
        check["problems"].append("The next link in the chain does not point to this record.")
    check["position"] = position
    return check


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
    position, previous, following = await _neighbours(db, row.chain_sequence)
    newer = await has_newer_version(db, resolved)
    check = _check_link(row, previous or GENESIS_HASH, position,
                        {stable_id_of(resolved): resolved.revision + (1 if newer else 0)})
    # The next link must point back at this one, or this one was replaced.
    check["next_links_back"] = following is None or following == row.hash
    if not check["next_links_back"]:
        check["valid"] = False
        check["problems"].append("The next receipt in the chain does not point to this receipt.")
    check["position"] = position
    return check
