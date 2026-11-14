"""Copy the whole trace of public participation to another database, such as production.

Each step of "what happened to the public's views" is stored here, and production needs all of them:

    committee reports   the report's text and its entries (who said what, what the committee decided)
    report analyses     each submission, its stakeholder, and the committee's decision and reason
    House traces        what the whole House did with the committee's recommendations
    Act traces          the final Act's text and which recommendations made it into the law

Usage (inside the backend container):

    python -m app.scripts.trace_bundle export                   # -> /app/var/trace_bundle.json.gz
    docker compose exec -e DATABASE_URL="postgresql+asyncpg://...production..." backend \
        python -m app.scripts.trace_bundle import                # into production
    python -m app.scripts.trace_bundle import --replace          # also overwrite analyses and traces already there

Run the Parliament and county syncs against production first, so its bills exist.

Records are matched by what identifies them in the world, not by database ids: reports by their official
PDF address, bills by their identifier (or exact title and year). Where production already holds a report
under another id, every reference to it and its entries is rewritten to production's ids. Nothing a citizen
or reviewer created in production is deleted: a report whose entries are already matched to submissions
keeps its entries, and is reported as needing a person instead.
"""
from __future__ import annotations

import argparse
import asyncio
import gzip
import json
import re
import uuid
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import delete, func, select

from app.database import async_session
from app.models import ActTrace, CommitteeReport, HouseTrace, LegislativeItem, ReportAnalysis, ReportEntry, SubmissionMatch

DEFAULT_FILE = Path("/app/var/trace_bundle.json.gz")
VERSION = 1
REPORT_FIELDS = ("institution", "title", "committee_name", "committee_url", "bill_house", "bill_number", "bill_year",
                 "source_url", "source_document_ref", "source_sha256", "source_mime_type", "source_size_bytes",
                 "extraction_status", "ocr_used", "extracted_text", "provenance")
ENTRY_FIELDS = ("clause_ref", "extracted_summary", "treatment", "stated_reason")
ANALYSIS_FIELDS = ("model", "entries_analysed", "items", "summary", "submitters")
HOUSE_FIELDS = ("sittings", "hansard_text", "model", "items")
ACT_FIELDS = ("act_title", "act_citation", "act_url", "sha256", "act_text", "model", "items", "bill_text")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _plain(value):
    return value.isoformat() if isinstance(value, (datetime, date)) else value


def _bill_ref(bill: LegislativeItem | None) -> dict | None:
    return {"identifier": bill.identifier, "title": bill.title, "year": bill.bill_year} if bill else None


def remap(value, ids: dict[str, str]):
    """Rewrite every record id inside JSON (entry_id, "report:entry" keys) to the other database's ids."""
    if not ids:
        return value
    if isinstance(value, str):
        return UUID_RE.sub(lambda m: ids.get(m.group(0), m.group(0)), value)
    if isinstance(value, list):
        return [remap(v, ids) for v in value]
    if isinstance(value, dict):
        return {remap(k, ids): remap(v, ids) for k, v in value.items()}
    return value


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
async def export(out: Path = DEFAULT_FILE) -> dict:
    async with async_session() as db:
        bills = {b.id: b for b in (await db.execute(select(LegislativeItem))).scalars()}
        reports = (await db.execute(select(CommitteeReport).where(
            CommitteeReport.is_simulated.is_(False), CommitteeReport.source_url.is_not(None),
            (CommitteeReport.bill_ref.is_not(None)) | (CommitteeReport.extracted_text.is_not(None))))).scalars().all()
        entries: dict = {}
        for entry in (await db.execute(select(ReportEntry))).scalars():
            entries.setdefault(entry.report_ref, []).append(entry)
        analyses = {a.report_ref: a for a in (await db.execute(select(ReportAnalysis))).scalars()}
        house = (await db.execute(select(HouseTrace))).scalars().all()
        acts = (await db.execute(select(ActTrace).where(ActTrace.act_text.is_not(None) | ActTrace.act_url.is_not(None)))).scalars().all()

    def real(bill_id):
        bill = bills.get(bill_id)
        return bill if bill is not None and not bill.is_simulated else None

    data = {"version": VERSION, "exported_at": datetime.now().isoformat(), "reports": [], "house": [], "acts": []}
    for report in reports:
        analysis = analyses.get(report.id)
        data["reports"].append({
            "id": str(report.id), "bill": _bill_ref(real(report.bill_ref)), "date_tabled": _plain(report.date_tabled),
            **{f: getattr(report, f) for f in REPORT_FIELDS},
            "entries": [{"id": str(e.id), **{f: getattr(e, f) for f in ENTRY_FIELDS}} for e in entries.get(report.id, [])],
            "analysis": {**{f: getattr(analysis, f) for f in ANALYSIS_FIELDS}, "created_at": _plain(analysis.created_at)} if analysis else None,
        })
    for row in house:
        if real(row.bill_ref):
            data["house"].append({"bill": _bill_ref(real(row.bill_ref)), "checked_at": _plain(row.checked_at), **{f: getattr(row, f) for f in HOUSE_FIELDS}})
    for row in acts:
        if real(row.bill_ref):
            data["acts"].append({"bill": _bill_ref(real(row.bill_ref)), "checked_at": _plain(row.checked_at), **{f: getattr(row, f) for f in ACT_FIELDS}})
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, "wt", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)
    counts = {"reports": len(data["reports"]), "entries": sum(len(r["entries"]) for r in data["reports"]),
              "analyses": sum(1 for r in data["reports"] if r["analysis"]), "house": len(data["house"]), "acts": len(data["acts"])}
    print(f"Exported to {out}: {counts}", flush=True)
    return counts


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------
async def find_bill(db, ref: dict | None) -> LegislativeItem | None:
    if not ref:
        return None
    bill = (await db.execute(select(LegislativeItem).where(LegislativeItem.identifier == ref["identifier"]))).scalar_one_or_none()
    if bill is None:  # created there under another identifier: the exact title and year
        found = (await db.execute(select(LegislativeItem).where(
            LegislativeItem.title == ref["title"], LegislativeItem.bill_year == ref["year"]))).scalars().all()
        bill = found[0] if len(found) == 1 else None
    return bill if bill is not None and not bill.is_simulated else None


def _when(value):
    return datetime.fromisoformat(value) if value else None


async def _import_report(db, item: dict, ids: dict[str, str], replace: bool, counts: dict) -> None:
    bill = await find_bill(db, item["bill"])
    query = select(CommitteeReport).where(CommitteeReport.source_url == item["source_url"])
    query = query.where(CommitteeReport.committee_url == item["committee_url"]) if item["committee_url"] else query.where(CommitteeReport.committee_url.is_(None))
    report = (await db.execute(query)).scalars().first() or await db.get(CommitteeReport, uuid.UUID(item["id"]))
    if report is None:
        report = CommitteeReport(id=uuid.UUID(item["id"]), is_simulated=False, date_tabled=date.fromisoformat(item["date_tabled"]),
                                 **{f: item[f] for f in REPORT_FIELDS})
        report.bill_ref = bill.id if bill else None
        db.add(report)
        await db.flush()
        counts["reports_added"] += 1
    else:
        if str(report.id) != item["id"]:
            ids[item["id"]] = str(report.id)
        if report.bill_ref is None and bill is not None:
            report.bill_ref = bill.id
        if not report.extracted_text and item["extracted_text"]:
            for field in ("extracted_text", "extraction_status", "ocr_used", "source_sha256", "source_mime_type", "source_size_bytes"):
                setattr(report, field, item[field])
        counts["reports_matched"] += 1

    theirs = (await db.execute(select(ReportEntry).where(ReportEntry.report_ref == report.id))).scalars().all()
    if theirs:
        index = {(e.clause_ref, e.extracted_summary): str(e.id) for e in theirs}
        mapped = {e["id"]: index.get((e["clause_ref"], e["extracted_summary"])) for e in item["entries"]}
        if all(mapped.values()):
            ids.update({ours: their for ours, their in mapped.items() if ours != their})
        else:
            used = (await db.execute(select(func.count()).select_from(SubmissionMatch).where(
                SubmissionMatch.report_entry_ref.in_([e.id for e in theirs])))).scalar_one()
            existing = (await db.execute(select(ReportAnalysis).where(ReportAnalysis.report_ref == report.id))).scalar_one_or_none()
            if used or (existing and not replace):
                counts["needs_a_person"] += 1  # entries there differ and are in use: never overwritten
                print(f"  kept the entries already there for {item['title'] or item['source_url']}", flush=True)
                return
            if existing:
                await db.delete(existing)
            await db.execute(delete(ReportEntry).where(ReportEntry.report_ref == report.id))
            theirs = []
    if not theirs:
        for entry in item["entries"]:
            db.add(ReportEntry(id=uuid.UUID(entry["id"]), report_ref=report.id, **{f: entry[f] for f in ENTRY_FIELDS}))
        counts["entries_added"] += len(item["entries"])
    await db.flush()

    if item["analysis"]:
        analysis = (await db.execute(select(ReportAnalysis).where(ReportAnalysis.report_ref == report.id))).scalar_one_or_none()
        if analysis is None or replace:
            if analysis is None:
                analysis = ReportAnalysis(report_ref=report.id)
                db.add(analysis)
            for field in ANALYSIS_FIELDS:
                setattr(analysis, field, remap(item["analysis"][field], ids))
            counts["analyses"] += 1


async def _import_trace(db, model, fields, item: dict, ids: dict[str, str], replace: bool, counts: dict, name: str) -> None:
    bill = await find_bill(db, item["bill"])
    if bill is None:
        counts["no_bill"] += 1
        return
    row = (await db.execute(select(model).where(model.bill_ref == bill.id))).scalar_one_or_none()
    has_content = row is not None and (row.act_text if model is ActTrace else row.checked_at)
    if has_content and not replace:
        counts[f"{name}_kept"] += 1
        return
    if row is None:
        row = model(bill_ref=bill.id, items=[])
        db.add(row)
    for field in fields:
        setattr(row, field, remap(item[field], ids) if field in ("items", "sittings") else item[field])
    row.items = row.items or []
    row.checked_at = _when(item["checked_at"])
    if model is ActTrace:
        row.storage_ref = None  # the PDF file stays where it was loaded; the Act links to its official copy
    counts[name] += 1


async def import_(file: Path = DEFAULT_FILE, replace: bool = False) -> dict:
    with gzip.open(file, "rt", encoding="utf-8") as handle:
        data = json.load(handle)
    if data.get("version") != VERSION:
        raise SystemExit(f"{file} is bundle version {data.get('version')}; this script reads version {VERSION}.")
    counts = dict.fromkeys(("reports_added", "reports_matched", "entries_added", "analyses", "needs_a_person",
                            "house", "house_kept", "acts", "acts_kept", "no_bill"), 0)
    ids: dict[str, str] = {}
    async with async_session() as db:
        # One short transaction per record: a distant hosted database drops connections held open for long.
        steps = [(_import_report, (item, ids, replace, counts), item["source_url"]) for item in data["reports"]]
        steps += [(_import_trace, (HouseTrace, HOUSE_FIELDS, item, ids, replace, counts, "house"), item["bill"]) for item in data["house"]]
        steps += [(_import_trace, (ActTrace, ACT_FIELDS, item, ids, replace, counts, "acts"), item["bill"]) for item in data["acts"]]
        for i, (step, step_args, label) in enumerate(steps, 1):
            try:
                await step(db, *step_args)
                await db.commit()
            except Exception as exc:  # one bad record must not stop the rest
                await db.rollback()
                counts["failed"] = counts.get("failed", 0) + 1
                print(f"  FAILED {label}: {exc}", flush=True)
            if i % 50 == 0:
                print(f"  {i}/{len(steps)}", flush=True)
    print(f"Imported {file}: {counts}", flush=True)
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["export", "import"])
    parser.add_argument("--file", default=str(DEFAULT_FILE), help="the bundle to write or read")
    parser.add_argument("--replace", action="store_true", help="import: overwrite analyses and traces already there")
    args = parser.parse_args()
    asyncio.run(export(Path(args.file)) if args.command == "export" else import_(Path(args.file), args.replace))
