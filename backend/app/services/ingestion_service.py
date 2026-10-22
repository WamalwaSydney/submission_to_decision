"""Committee-report extraction with native-text and OCR fallback."""
import os
import re
import tempfile
import logging
import asyncio
import subprocess
from datetime import date, datetime
from pathlib import Path
from typing import List, Tuple
from urllib.parse import urlparse
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import CommitteeReport, ReportEntry

log = logging.getLogger(__name__)
_pdf_ocr_semaphore = asyncio.Semaphore(1)
_report_extraction_lock = asyncio.Lock()


def normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


async def ingest_report(db: AsyncSession, bill_ref: str, institution: str, file_path: str,
                        date_tabled: str | date, *, source_url: str | None = None,
                        source_metadata: dict | None = None, uploaded_by=None) -> CommitteeReport:
    if isinstance(date_tabled, str):
        date_tabled = date.fromisoformat(date_tabled)
    elif isinstance(date_tabled, datetime):
        date_tabled = date_tabled.date()
    async with _pdf_ocr_semaphore:
        text, ocr_used = await asyncio.to_thread(extract_text, file_path)
    entries = parse_report_entries(text)
    report = CommitteeReport(
        bill_ref=bill_ref, institution=institution, date_tabled=date_tabled,
        source_document_ref=os.path.basename(file_path), source_url=source_url,
        extraction_status="ocr_used" if ocr_used else "extracted", ocr_used=ocr_used,
        extracted_text=text, provenance=source_metadata or {}, uploaded_by=uploaded_by,
    )
    db.add(report)
    await db.flush()
    for clause_ref, summary, treatment, reason in entries:
        db.add(ReportEntry(report_ref=report.id, clause_ref=clause_ref,
                           extracted_summary=summary, treatment=treatment,
                           stated_reason=reason))
    await db.commit()
    await db.refresh(report)
    return report


def extract_text(file_path: str) -> Tuple[str, bool]:
    try:
        native = subprocess.run(
            ["pdftotext", "-layout", file_path, "-"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=45,
        )
        text = native.stdout
        if len(text.strip()) >= 100:
            return text, False
    except Exception:
        pass
    return ocr_extract(file_path), True


def ocr_extract(file_path: str) -> str:
    info = subprocess.run(
        ["pdfinfo", file_path], check=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, timeout=20,
    ).stdout
    page_line = next((line for line in info.splitlines() if line.startswith("Pages:")), None)
    page_count = int(page_line.split(":", 1)[1].strip()) if page_line else 0
    if page_count < 1:
        raise ValueError("PDF has no readable pages")
    pages = []
    with tempfile.TemporaryDirectory(prefix="parliament-ocr-page-") as directory:
        prefix = str(Path(directory) / "page")
        image_path = f"{prefix}.jpg"
        for page_number in range(1, page_count + 1):
            rendered = subprocess.run(
                ["pdftoppm", "-f", str(page_number), "-l", str(page_number), "-singlefile", "-r", "120", "-gray", "-jpeg", file_path, prefix],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45,
            )
            if rendered.returncode != 0 or not Path(image_path).exists():
                raise RuntimeError(f"Poppler could not render PDF page {page_number}")
            ocr = subprocess.run(
                ["tesseract", image_path, "stdout", "--dpi", "120"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                encoding="utf-8", errors="replace", timeout=60,
            )
            if ocr.returncode != 0:
                raise RuntimeError(f"Tesseract could not OCR PDF page {page_number}")
            pages.append(f"[Page {page_number}]\n{ocr.stdout}")
            Path(image_path).unlink(missing_ok=True)
    return "\n".join(pages)


CLAUSE_RE = re.compile(r"^(?:clause|section|article|paragraph)\s+([A-Za-z0-9().\-]+)\s*[:\-–—]?\s*(.*)$", re.I)
REASON_RE = re.compile(r"^(?:reason|rationale|justification)\s*[:\-]\s*(.*)$", re.I)
TREATMENT_PATTERNS = (
    ("rejected with reasons", re.compile(r"\b(?:committee\s+(?:rejected|rejects|declined|recommends?\s+rejecting)|rejected\s+by\s+the\s+committee)\b", re.I)),
    ("amended", re.compile(r"\b(?:committee\s+(?:amended|modif(?:ied|ies)|revised|recommends?\s+amending)|amended\s+by\s+the\s+committee)\b", re.I)),
    ("adopted", re.compile(r"\b(?:committee\s+(?:adopted|accepts?|approved|recommends?\s+adoption)|adopted\s+by\s+the\s+committee)\b", re.I)),
)


def parse_report_entries(text: str) -> List[Tuple[str, str, str, str | None]]:
    """Parse common headings and retain every result for human verification."""
    entries = []
    current = None
    for raw in text.splitlines():
        line = normalize_line(raw)
        if not line or line.startswith("[Page "):
            continue
        match = CLAUSE_RE.match(line)
        if match:
            if current:
                entries.append(_finalize(current))
            current = {"ref": f"Clause {match.group(1)}", "summary": [], "treatment": None, "reason": None}
            if match.group(2):
                current["summary"].append(match.group(2))
            continue
        if current is None:
            continue
        reason = REASON_RE.match(line)
        if reason:
            current["reason"] = reason.group(1).strip()
            continue
        for treatment, pattern in TREATMENT_PATTERNS:
            if pattern.search(line):
                current["treatment"] = treatment
                break
        current["summary"].append(line)
    if current:
        entries.append(_finalize(current))
    return entries


def _finalize(item: dict) -> Tuple[str, str, str, str | None]:
    return item["ref"], normalize_line(" ".join(item["summary"])), item["treatment"] or "unclassified", item["reason"]


async def extract_pending_linked_reports(db: AsyncSession, bill_ref=None, *, report_id=None) -> int:
    """Download and extract linked official Parliament PDFs before matching.

    Only HTTPS URLs on parliament.go.ke (or its subdomains) are accepted. The
    document is size-limited, and extraction status prevents repeated downloads
    for reports that have already been processed or need manual review.
    """
    query = select(CommitteeReport.id).where(
        CommitteeReport.extraction_status.in_(["pending", "extracting"]),
        CommitteeReport.source_url.is_not(None),
    )
    if report_id is not None:
        query = query.where(CommitteeReport.id == report_id)
    elif bill_ref is not None:
        query = query.where(CommitteeReport.bill_ref == bill_ref)
    else:
        return 0
    result = await db.execute(query)
    report_ids = list(result.scalars().all())
    extracted_count = 0
    for report_id in report_ids:
        async with _report_extraction_lock:
            # `extracting` is included to recover rows left by older versions
            # that committed this state before Render killed the process.
            result = await db.execute(
                select(CommitteeReport)
                .where(
                    CommitteeReport.id == report_id,
                    CommitteeReport.extraction_status.in_(["pending", "extracting"]),
                )
                .with_for_update()
            )
            report = result.scalar_one_or_none()
            if report is None:
                continue
            report.extraction_status = "extracting"
            try:
                parsed = urlparse(report.source_url or "")
                if parsed.scheme != "https" or not parsed.hostname or not (
                    parsed.hostname == "parliament.go.ke" or parsed.hostname.endswith(".parliament.go.ke")
                ):
                    raise ValueError("The linked report URL is not on the official Parliament HTTPS domain")

                chunks = []
                total_bytes = 0
                async with httpx.AsyncClient(timeout=90, follow_redirects=True, headers={"User-Agent": "ParticipationTrace/1.0 (official report text extraction)"}) as client:
                    async with client.stream("GET", report.source_url) as response:
                        response.raise_for_status()
                        final_host = urlparse(str(response.url)).hostname or ""
                        if final_host != "parliament.go.ke" and not final_host.endswith(".parliament.go.ke"):
                            raise ValueError("PDF redirect left the official Parliament domain")
                        async for chunk in response.aiter_bytes():
                            total_bytes += len(chunk)
                            if total_bytes > 35 * 1024 * 1024:
                                raise ValueError("PDF exceeded the 35 MB extraction limit")
                            chunks.append(chunk)
                pdf_bytes = b"".join(chunks)
                if not pdf_bytes.startswith(b"%PDF"):
                    raise ValueError("The linked document is not a readable PDF")

                with tempfile.TemporaryDirectory(prefix="parliament-report-") as directory:
                    pdf_path = Path(directory) / "report.pdf"
                    pdf_path.write_bytes(pdf_bytes)
                    async with _pdf_ocr_semaphore:
                        text, ocr_used = await asyncio.to_thread(extract_text, str(pdf_path))
                entries = parse_report_entries(text)
                if not entries:
                    entries = parse_unstructured_report_entries(text)
                entries = [entry for entry in entries if entry[1].strip()]
                if not entries:
                    report.extraction_status = "needs_review"
                    report.ocr_used = ocr_used
                    await db.commit()
                    continue

                for clause_ref, summary, treatment, reason in entries:
                    db.add(ReportEntry(
                        report_ref=report.id,
                        clause_ref=clause_ref,
                        extracted_summary=summary,
                        treatment=treatment,
                        stated_reason=reason,
                    ))
                report.extraction_status = "ocr_used" if ocr_used else "extracted"
                report.ocr_used = ocr_used
                await db.commit()
                extracted_count += 1
            except Exception:
                log.exception("Could not extract linked committee report %s", report.id)
                await db.rollback()
                failed_result = await db.execute(
                    select(CommitteeReport)
                    .where(CommitteeReport.id == report_id)
                    .with_for_update()
                )
                failed_report = failed_result.scalar_one_or_none()
                if failed_report:
                    failed_report.extraction_status = "needs_review"
                    await db.commit()
    return extracted_count


def parse_unstructured_report_entries(text: str) -> List[Tuple[str, str, str, str | None]]:
    """Split readable report text into reviewable text blocks without claiming outcomes."""
    cleaned = []
    for raw in text.splitlines():
        line = normalize_line(raw)
        if not line or line.startswith("[Page "):
            continue
        if re.match(r"^(page\s+\d+|republic of kenya|national assembly|senate|committee report)\b", line, re.I):
            continue
        cleaned.append(line)
    full_text = normalize_line(" ".join(cleaned))
    if len(full_text) < 120:
        return []
    chunks = [full_text[index:index + 1200] for index in range(0, len(full_text), 1200)]
    return [
        (f"Report text {index + 1}", chunk.strip(), "unclassified", None)
        for index, chunk in enumerate(chunks)
        if len(chunk.strip()) >= 80
    ]
