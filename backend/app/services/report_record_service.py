"""Seal the submissions committee reports record into the receipt hash chain.

Submissions made to a committee directly (memoranda, hearings) never pass through the platform, so they have no
receipt. When a report is read, each submission it records becomes a report record (REC-XXXXXX): what the report
says about it, the committee's decision and reason, and the report file's SHA-256, chained to the link before it.

A record proves the platform's copy has not been changed since it was sealed. It does not prove when the person made
the submission, or that the reading of the report was right: anyone can open the report (its SHA-256 identifies the
exact file) to check.

Records are append-only. A submission is sealed once: from the AI reading of the report when there is one, or, for a
report a Clerk's Office uploaded, from the entries the text reader found a decision for. Re-running the analysis does
not rewrite records already sealed.
"""
import hashlib
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import exists, select
from sqlalchemy.orm import defer
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, CommitteeReport, LegislativeItem, ReportAnalysis, ReportEntry, ReportRecord
from app.services import receipt_service

log = logging.getLogger(__name__)

ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
DECISIONS = {"adopted", "amended", "rejected", "not addressed"}
TREATMENT_DECISION = {"adopted": "adopted", "amended": "amended", "rejected with reasons": "rejected", "not addressed": "not addressed"}


def record_public_id(report_ref, entry_key: str, length: int = 6) -> str:
    """A stable ID for a record, so the same report entry gets the same REC- ID in every database."""
    digest = hashlib.sha256(f"{report_ref}:{entry_key}".encode()).digest()
    return "REC-" + "".join(ID_CHARS[b % len(ID_CHARS)] for b in digest[:length])


def _text(value, limit=None):
    value = (str(value).strip() if value is not None else "") or None
    return value[:limit] if value and limit else value


def item_keys(items) -> list:
    """The record key for each item of an AI reading of a report, in order (None for an item that is not sealed)."""
    keys, seen = [], {}
    for index, item in enumerate(items or []):
        item = item or {}
        if item.get("decision") not in DECISIONS or not _text(item.get("issue")):
            keys.append(None)
            continue
        key = str(item.get("entry_id") or f"item-{index}")
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:  # the AI can list two submissions from one report entry
            key = f"{key}#{seen[key]}"
        keys.append(key[:100])
    return keys


async def record_ids_by_key(db: AsyncSession, report_ids) -> dict:
    """{(report id, entry key): REC- ID} for the given reports."""
    ids = list(report_ids)
    if not ids:
        return {}
    rows = (await db.execute(select(ReportRecord.report_ref, ReportRecord.entry_key, ReportRecord.public_id)
                             .where(ReportRecord.report_ref.in_(ids)))).all()
    return {(str(ref), key): public_id for ref, key, public_id in rows}


async def _candidates(db: AsyncSession, report: CommitteeReport, analysis: ReportAnalysis | None) -> list[dict]:
    """The submissions this report records, in report order."""
    out = []
    if analysis is not None:
        for item, key in zip(analysis.items or [], item_keys(analysis.items)):
            if key is None:
                continue
            out.append({"entry_key": key, "source": "analysis", "stakeholder": _text(item.get("stakeholder")),
                        "clause_ref": _text(item.get("clause_ref"), 255), "issue": _text(item.get("issue")),
                        "decision": item["decision"], "reason": _text(item.get("reason"))})
        return out
    if report.uploaded_by is None:
        # Reports synced from official sites wait for their AI reading: the text reader's entries for long
        # Parliament reports are too rough to seal. Reports a Clerk's Office uploads are sealed from the text reader.
        return out
    entries = (await db.execute(
        select(ReportEntry).where(ReportEntry.report_ref == report.id, ReportEntry.treatment.in_(TREATMENT_DECISION))
        .order_by(ReportEntry.clause_ref, ReportEntry.id)
    )).scalars().all()
    for entry in entries:
        issue = _text(entry.extracted_summary)
        if issue:
            out.append({"entry_key": str(entry.id), "source": "parsed", "stakeholder": None, "clause_ref": _text(entry.clause_ref, 255),
                        "issue": issue, "decision": TREATMENT_DECISION[entry.treatment], "reason": _text(entry.stated_reason)})
    return out


async def seal_new_records(db: AsyncSession, report_ids=None) -> int:
    """Append a chained record for every submission in a live committee report that is not sealed yet.

    Holds the chain lock for the whole run, so receipts issued meanwhile wait and then chain after these records.
    Returns how many records were added.
    """
    # Reports already sealed are skipped (a report's submissions are sealed together, once), and reports are loaded
    # without their text: this runs every few minutes, and sending long report texts and every AI reading out of the
    # database each time used up the hosted database's monthly network transfer.
    query = (select(CommitteeReport, ReportAnalysis)
             .options(defer(CommitteeReport.extracted_text))
             .where(~exists().where(ReportRecord.report_ref == CommitteeReport.id))
             .join(LegislativeItem, LegislativeItem.id == CommitteeReport.bill_ref)
             .outerjoin(ReportAnalysis, ReportAnalysis.report_ref == CommitteeReport.id)
             .where(CommitteeReport.is_simulated.is_(False), LegislativeItem.is_simulated.is_(False))
             .order_by(CommitteeReport.date_tabled.asc().nulls_last(), CommitteeReport.id))
    if report_ids is not None:
        query = query.where(CommitteeReport.id.in_(list(report_ids)))
    pairs = (await db.execute(query)).all()
    if not pairs:
        return 0

    await receipt_service.lock_chain(db)
    sealed = {(ref, key) for ref, key in (await db.execute(select(ReportRecord.report_ref, ReportRecord.entry_key))).all()}
    used_ids = set((await db.execute(select(ReportRecord.public_id))).scalars().all())
    previous_hash = await receipt_service.get_chain_head(db)
    sequence = await receipt_service.next_chain_sequence(db)
    added = 0
    for report, analysis in pairs:
        new = [c for c in await _candidates(db, report, analysis) if (report.id, c["entry_key"]) not in sealed]
        if not new:
            continue
        for candidate in new:
            length = 6
            public_id = record_public_id(report.id, candidate["entry_key"])
            while public_id in used_ids:
                length += 1
                public_id = record_public_id(report.id, candidate["entry_key"], length)
            used_ids.add(public_id)
            record = {**candidate, "id": uuid.uuid4(), "public_id": public_id, "report_ref": report.id,
                      "legislative_item_id": report.bill_ref, "report_sha256": report.source_sha256,
                      "recorded_at": datetime.now(timezone.utc), "previous_hash": previous_hash, "chain_sequence": sequence}
            record["hash"] = receipt_service.compute_record_hash(record)
            db.add(ReportRecord(**record))
            previous_hash, sequence, added = record["hash"], sequence + 1, added + 1
        db.add(AuditLog(entity_type="committee_report", entity_id=report.id, action="records_sealed",
                        details=f"{len(new)} submissions recorded in the report sealed into the hash chain"))
    await db.commit()
    if added:
        log.info("Sealed %d report records into the hash chain", added)
    return added
