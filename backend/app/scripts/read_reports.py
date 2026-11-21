"""Read every committee report linked to a bill, then match it and seal what it records. Runs nightly in GitHub Actions.

    python -m app.scripts.read_reports

Why here and not only in the API: the API runs on a small server, where OCR of a long scanned report hits its time
limits and some pages are left unread. GitHub's runner has more CPU, memory and up to six hours, so the limits are set
high (see .github/workflows/sync.yml) and every report gets read in full.

What it reads, for linked, live reports with an official PDF link:
  * not yet read ("pending"), or claimed by a reader that has not finished within READ_STALE_HOURS ("extracting");
  * read before without any text ("needs_review", no text: for example a file over the old size limit);
  * read in part ("needs_review" with text) and safe to read again: no matches, no AI reading and no hash-chain
    records point at its entries yet. Its old entries are replaced.

A report is claimed first, then downloaded and OCR'd with no database transaction open (OCR can take many minutes and
a hosted database drops long-held connections), then saved in one short transaction. Each attempt and its outcome
are kept in the report's provenance (read_attempts, last_read_at, last_read_error), so a report that keeps failing is
visible. After reading, matches are proposed for the bill's submissions and new report records are sealed.

Exit status is 0 even when some reports could not be read; they are listed in the job summary and retried next night.
"""
import asyncio
import hashlib
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx
from sqlalchemy import select, text
from sqlalchemy.orm.attributes import flag_modified

from app.database import async_session
from app.models import CommitteeReport, ReportEntry
from app.services import ingestion_service, linking_service, report_record_service

BUDGET_SECONDS = int(os.getenv("READ_BUDGET_MINUTES", "300")) * 60
STALE_AFTER = timedelta(hours=int(os.getenv("READ_STALE_HOURS", "6")))
MAX_ATTEMPTS = int(os.getenv("READ_MAX_ATTEMPTS", "10"))

CANDIDATES_SQL = """
SELECT r.id, r.bill_ref, r.extraction_status, coalesce(r.title, r.source_document_ref) AS name,
       length(coalesce(r.extracted_text, '')) > 0 AS has_text, r.provenance
FROM committee_reports r
WHERE r.is_simulated = false AND r.bill_ref IS NOT NULL AND r.source_url LIKE 'https://%'
  AND (
    r.extraction_status IN ('pending', 'extracting')
    OR (r.extraction_status = 'needs_review' AND coalesce(r.extracted_text, '') = '')
    OR (r.extraction_status = 'needs_review'
        AND NOT EXISTS (SELECT 1 FROM report_analyses a WHERE a.report_ref = r.id)
        AND NOT EXISTS (SELECT 1 FROM report_records x WHERE x.report_ref = r.id)
        AND NOT EXISTS (SELECT 1 FROM submission_matches m JOIN report_entries e ON e.id = m.report_entry_ref
                        WHERE e.report_ref = r.id))
  )
ORDER BY (r.extraction_status = 'needs_review'), r.date_tabled DESC NULLS LAST
"""


def _when(value):
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None


async def _claim(report_id, now) -> dict | None:
    """Mark the report as being read by this job. None if someone else is reading it or it has failed too often."""
    async with async_session() as db:
        report = (await db.execute(select(CommitteeReport).where(CommitteeReport.id == report_id).with_for_update())).scalar_one_or_none()
        if report is None or report.extraction_status not in ("pending", "extracting", "needs_review"):
            return None  # read by someone else meanwhile
        provenance = dict(report.provenance or {})
        claimed = _when(provenance.get("read_claimed_at"))
        if report.extraction_status == "extracting" and claimed and now - claimed < STALE_AFTER:
            return None  # another reader is on it
        if int(provenance.get("read_attempts", 0)) >= MAX_ATTEMPTS:
            return None
        provenance.update(read_attempts=int(provenance.get("read_attempts", 0)) + 1, read_claimed_at=now.isoformat())
        report.provenance = provenance
        flag_modified(report, "provenance")
        report.extraction_status = "extracting"
        await db.commit()
        return {"id": report.id, "bill_ref": report.bill_ref, "source_url": report.source_url}


async def _download(url: str, path: Path) -> tuple[str, int]:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not ingestion_service.is_official_report_host(parsed.hostname):
        raise ValueError("The report link is not on an official Parliament or county assembly HTTPS site")
    digest, size = hashlib.sha256(), 0
    timeout = httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True,
                                 headers={"User-Agent": "ParticipationTrace/1.0 (official report text extraction)"}) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            if not ingestion_service.is_official_report_host(urlparse(str(response.url)).hostname):
                raise ValueError("The report link redirected away from the official site")
            with open(path, "wb") as handle:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > ingestion_service.PDF_MAX_BYTES:
                        raise ValueError(f"The PDF is over the {ingestion_service.PDF_MAX_BYTES // (1024 * 1024)} MB limit")
                    digest.update(chunk)
                    handle.write(chunk)
    with open(path, "rb") as handle:
        if handle.read(4) != b"%PDF":
            raise ValueError("The link does not return a PDF")
    return digest.hexdigest(), size


async def _read(job: dict) -> dict:
    """Download and OCR one report, with no database transaction open."""
    with tempfile.TemporaryDirectory(prefix="read-report-") as directory:
        path = Path(directory) / "report.pdf"
        sha256, size = await _download(job["source_url"], path)
        text_value, ocr_used = await asyncio.to_thread(ingestion_service.extract_text, str(path))
    entries = ingestion_service.parse_report_entries(text_value) or ingestion_service.parse_unstructured_report_entries(text_value)
    entries = [entry for entry in entries if entry[1].strip()]
    partial = ingestion_service._has_ocr_failures(text_value)
    status = "needs_review" if partial or not entries else ("ocr_used" if ocr_used else "extracted")
    return {"text": text_value, "ocr_used": ocr_used, "entries": entries, "status": status, "sha256": sha256, "size": size}


async def _save(job: dict, result: dict | None, error: str | None, now) -> str:
    async with async_session() as db:
        report = await db.get(CommitteeReport, job["id"])
        provenance = dict(report.provenance or {})
        provenance.pop("read_claimed_at", None)
        provenance["last_read_at"] = now.isoformat()
        if error:
            provenance["last_read_error"] = error[:500]
            # Keep what an earlier read found; otherwise mark it unread so it is retried.
            report.extraction_status = "needs_review"
        else:
            provenance.pop("last_read_error", None)
            await db.execute(text("DELETE FROM report_entries WHERE report_ref = :id"), {"id": report.id})
            for clause_ref, summary, treatment, reason in result["entries"]:
                db.add(ReportEntry(report_ref=report.id, clause_ref=clause_ref, extracted_summary=summary,
                                   treatment=treatment, stated_reason=reason))
            report.extracted_text = result["text"]
            report.ocr_used = result["ocr_used"]
            report.extraction_status = result["status"]
            report.source_sha256 = report.source_sha256 or result["sha256"]
            report.source_size_bytes = report.source_size_bytes or result["size"]
        report.provenance = provenance
        flag_modified(report, "provenance")
        await db.commit()
        return report.extraction_status


async def main() -> None:
    started = time.monotonic()
    async with async_session() as db:
        candidates = (await db.execute(text(CANDIDATES_SQL))).all()
    print(f"{len(candidates)} report(s) to read", flush=True)
    outcomes, bills, unread = {}, set(), []
    for row in candidates:
        if time.monotonic() - started > BUDGET_SECONDS:
            print("Time budget reached; the rest will be read next run.", flush=True)
            break
        now = datetime.now(timezone.utc)
        job = await _claim(row.id, now)
        if job is None:
            continue
        try:
            result, error = await _read(job), None
        except Exception as exc:  # one bad report must not stop the rest
            result, error = None, f"{type(exc).__name__}: {exc}"
        status = await _save(job, result, error, now)
        outcomes[status] = outcomes.get(status, 0) + 1
        label = error or f"{status}, {len(result['entries'])} entries" + (" (some pages unread)" if result["status"] == "needs_review" and result["text"] else "")
        print(f"  {str(row.name)[:90]}: {label}", flush=True)
        if error or not (result and result["text"]):
            unread.append((row.name, error or "no text"))
        if result and result["entries"]:
            bills.add(job["bill_ref"])
    for bill_id in bills:  # propose matches for submissions on bills whose report was just read
        try:
            async with async_session() as db:
                proposals = await linking_service.propose_matches(db, bill_id, use_llm=True)
            print(f"  matches proposed for bill {bill_id}: {len(proposals)}", flush=True)
        except Exception as exc:
            print(f"  matching failed for bill {bill_id}: {type(exc).__name__}: {exc}", flush=True)
    async with async_session() as db:
        sealed = await report_record_service.seal_new_records(db)
    summary = [f"Read {sum(outcomes.values())} report(s): {outcomes}.", f"Proposed matches on {len(bills)} bill(s).",
               f"Sealed {sealed} report record(s)."]
    if unread:
        summary.append(f"{len(unread)} report(s) still unread, retried next run:")
        summary += [f"- {str(name)[:120]}: {reason}" for name, reason in unread]
    print("\n".join(summary), flush=True)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as handle:
            handle.write("## Committee reports read\n\n" + "\n".join(summary) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
