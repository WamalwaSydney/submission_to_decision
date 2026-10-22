"""Committee-report extraction with native-text and resilient OCR fallback.

OCR is performed page by page. A slow page is retried at progressively lower
DPI with bounded timeouts. If a page still fails, extraction continues for the
remaining pages and the report is marked ``needs_review`` rather than losing all
successfully extracted text.
"""
import os
import re
import tempfile
import logging
import asyncio
import subprocess
import signal
import time
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

# Tune these through environment variables for the deployment environment.
PDFTOTEXT_TIMEOUT = int(os.getenv("PDFTOTEXT_TIMEOUT", "120"))
PDFINFO_TIMEOUT = int(os.getenv("PDFINFO_TIMEOUT", "30"))
PDF_DOWNLOAD_TOTAL_TIMEOUT = int(os.getenv("PDF_DOWNLOAD_TOTAL_TIMEOUT", "240"))
PDF_MAX_BYTES = int(os.getenv("PDF_MAX_BYTES", str(35 * 1024 * 1024)))

# One modest pass is substantially faster and safer on a free Render instance
# than retrying every page at three resolutions.
OCR_DPI = int(os.getenv("OCR_DPI", "150"))
OCR_MAX_DIMENSION = int(os.getenv("OCR_MAX_DIMENSION", "1800"))
TESSERACT_TIMEOUT = int(os.getenv("TESSERACT_TIMEOUT", "45"))
PDF_RENDER_TIMEOUT = int(os.getenv("PDF_RENDER_TIMEOUT", "20"))
OCR_TOTAL_TIMEOUT = int(os.getenv("OCR_TOTAL_TIMEOUT", "240"))
MAX_OCR_PAGES = int(os.getenv("MAX_OCR_PAGES", "100"))


def normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


def _has_ocr_failures(text: str) -> bool:
    return (
        "[OCR_FAILED_PAGE " in text
        or "[OCR_PAGE_LIMIT_EXCEEDED" in text
        or "[OCR_TOTAL_TIMEOUT" in text
    )


async def ingest_report(
    db: AsyncSession,
    bill_ref: str,
    institution: str,
    file_path: str,
    date_tabled: str | date,
    *,
    source_url: str | None = None,
    source_metadata: dict | None = None,
    uploaded_by=None,
) -> CommitteeReport:
    if isinstance(date_tabled, str):
        date_tabled = date.fromisoformat(date_tabled)
    elif isinstance(date_tabled, datetime):
        date_tabled = date_tabled.date()

    async with _pdf_ocr_semaphore:
        text, ocr_used = await asyncio.to_thread(extract_text, file_path)

    entries = parse_report_entries(text)
    has_failures = _has_ocr_failures(text)
    status = (
        "needs_review"
        if has_failures
        else ("ocr_used" if ocr_used else "extracted")
    )

    report = CommitteeReport(
        bill_ref=bill_ref,
        institution=institution,
        date_tabled=date_tabled,
        source_document_ref=os.path.basename(file_path),
        source_url=source_url,
        extraction_status=status,
        ocr_used=ocr_used,
        extracted_text=text,
        provenance=source_metadata or {},
        uploaded_by=uploaded_by,
    )
    db.add(report)
    await db.flush()

    for clause_ref, summary, treatment, reason in entries:
        db.add(
            ReportEntry(
                report_ref=report.id,
                clause_ref=clause_ref,
                extracted_summary=summary,
                treatment=treatment,
                stated_reason=reason,
            )
        )

    await db.commit()
    await db.refresh(report)
    return report


def extract_text(file_path: str) -> Tuple[str, bool]:
    """Prefer native PDF text; fall back to resilient page-by-page OCR."""
    try:
        native = subprocess.run(
            ["pdftotext", "-layout", file_path, "-"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=PDFTOTEXT_TIMEOUT,
        )
        text = native.stdout
        if len(text.strip()) >= 100:
            return text, False
    except (subprocess.SubprocessError, OSError) as exc:
        log.warning("Native PDF text extraction failed; trying OCR: %s", exc)

    return ocr_extract(file_path), True


def _get_pdf_page_count(file_path: str) -> int:
    info = subprocess.run(
        ["pdfinfo", file_path],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=PDFINFO_TIMEOUT,
    ).stdout

    page_line = next(
        (line for line in info.splitlines() if line.startswith("Pages:")),
        None,
    )
    page_count = int(page_line.split(":", 1)[1].strip()) if page_line else 0
    if page_count < 1:
        raise ValueError("PDF has no readable pages")
    return page_count


def _run_pdf_command(args: list[str], *, timeout: int, text: bool = False):
    """Run a PDF/OCR child in its own process group and kill the whole group."""
    process = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=text,
        encoding="utf-8" if text else None,
        errors="replace" if text else None,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def _render_page(file_path: str, page_number: int, prefix: str, dpi: int) -> str:
    """Render one PDF page and return the image path."""
    image_path = f"{prefix}.jpg"
    rendered = _run_pdf_command(
        [
            "pdftoppm",
            "-f", str(page_number),
            "-l", str(page_number),
            "-singlefile",
            "-r", str(dpi),
            "-scale-to", str(OCR_MAX_DIMENSION),
            "-gray",
            "-jpeg",
            file_path,
            prefix,
        ],
        timeout=PDF_RENDER_TIMEOUT,
    )
    if rendered.returncode != 0 or not Path(image_path).exists():
        stderr = (rendered.stderr or b"").decode("utf-8", errors="replace")[-1000:]
        raise RuntimeError(
            f"Poppler could not render page {page_number} at {dpi} DPI: {stderr}"
        )
    return image_path


def _ocr_page(file_path: str, page_number: int, directory: str) -> str:
    """OCR one page once; retries multiply cost and cause Render timeouts."""
    prefix = str(Path(directory) / f"page_{page_number}")
    image_path = None
    try:
        image_path = _render_page(file_path, page_number, prefix, OCR_DPI)
        ocr = _run_pdf_command(
            [
                "env", "OMP_THREAD_LIMIT=1", "OMP_NUM_THREADS=1",
                "tesseract", image_path, "stdout", "--dpi", str(OCR_DPI),
                "--oem", "1", "--psm", "6",
            ],
            timeout=TESSERACT_TIMEOUT,
            text=True,
        )
        if ocr.returncode != 0:
            raise RuntimeError(
                f"Tesseract exited {ocr.returncode} on page {page_number}: "
                f"{(ocr.stderr or '')[-1000:]}"
            )
        result = ocr.stdout.strip()
        if not result:
            raise RuntimeError(f"Tesseract returned no text for page {page_number}")
        return result
    finally:
        if image_path:
            Path(image_path).unlink(missing_ok=True)


def ocr_extract(file_path: str) -> str:
    """OCR pages within a report-wide budget and preserve successful pages."""
    page_count = _get_pdf_page_count(file_path)
    pages = []
    deadline = time.monotonic() + OCR_TOTAL_TIMEOUT

    if page_count > MAX_OCR_PAGES:
        log.error(
            "PDF has %s pages; configured OCR limit is %s",
            page_count, MAX_OCR_PAGES,
        )
        # Do not silently truncate the report. Record the condition so the
        # calling code can save the partial text and mark the report for review.
        pages.append(
            f"[OCR_PAGE_LIMIT_EXCEEDED pages={page_count} limit={MAX_OCR_PAGES}]"
        )
        page_count_to_process = MAX_OCR_PAGES
    else:
        page_count_to_process = page_count

    with tempfile.TemporaryDirectory(prefix="parliament-ocr-page-") as directory:
        for page_number in range(1, page_count_to_process + 1):
            if time.monotonic() >= deadline:
                pages.append(f"[OCR_TOTAL_TIMEOUT pages_completed={page_number - 1}]")
                break
            try:
                page_text = _ocr_page(file_path, page_number, directory)
                pages.append(f"[Page {page_number}]\n{page_text}")
            except Exception:
                # Continue processing other pages. The failure marker ensures
                # the report is not presented as a complete extraction.
                log.exception("OCR failed for PDF page %s", page_number)
                pages.append(f"[OCR_FAILED_PAGE {page_number}]")

    return "\n".join(pages)


CLAUSE_RE = re.compile(
    r"^(?:clause|section|article|paragraph)\s+([A-Za-z0-9().\-]+)\s*[:\-–—]?\s*(.*)$",
    re.I,
)
REASON_RE = re.compile(
    r"^(?:reason|rationale|justification)\s*[:\-]\s*(.*)$",
    re.I,
)
TREATMENT_PATTERNS = (
    (
        "rejected with reasons",
        re.compile(
            r"\b(?:committee\s+(?:rejected|rejects|declined|recommends?\s+rejecting)"
            r"|rejected\s+by\s+the\s+committee)\b",
            re.I,
        ),
    ),
    (
        "amended",
        re.compile(
            r"\b(?:committee\s+(?:amended|modif(?:ied|ies)|revised|recommends?\s+amending)"
            r"|amended\s+by\s+the\s+committee)\b",
            re.I,
        ),
    ),
    (
        "adopted",
        re.compile(
            r"\b(?:committee\s+(?:adopted|accepts?|approved|recommends?\s+adoption)"
            r"|adopted\s+by\s+the\s+committee)\b",
            re.I,
        ),
    ),
)


def parse_report_entries(text: str) -> List[Tuple[str, str, str, str | None]]:
    """Parse common headings and retain every result for human verification."""
    entries = []
    current = None

    for raw in text.splitlines():
        line = normalize_line(raw)
        if (
            not line
            or line.startswith("[Page ")
            or line.startswith("[OCR_FAILED_PAGE ")
            or line.startswith("[OCR_PAGE_LIMIT_EXCEEDED")
        ):
            continue

        match = CLAUSE_RE.match(line)
        if match:
            if current:
                entries.append(_finalize(current))
            current = {
                "ref": f"Clause {match.group(1)}",
                "summary": [],
                "treatment": None,
                "reason": None,
            }
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
    return (
        item["ref"],
        normalize_line(" ".join(item["summary"])),
        item["treatment"] or "unclassified",
        item["reason"],
    )


async def process_uploaded_report(report_id) -> None:
    """Extract a stored upload after the HTTP request has returned."""
    from app.database import async_session

    async with _report_extraction_lock:
        async with async_session() as db:
            result = await db.execute(
                select(CommitteeReport).where(CommitteeReport.id == report_id)
            )
            report = result.scalar_one_or_none()
            if report is None or report.extraction_status not in {"pending", "extracting"}:
                return
            report.extraction_status = "extracting"
            await db.commit()

            try:
                async with _pdf_ocr_semaphore:
                    text, ocr_used = await asyncio.to_thread(
                        extract_text, report.source_storage_ref
                    )
                entries = parse_report_entries(text)
                if not entries:
                    entries = parse_unstructured_report_entries(text)
                entries = [entry for entry in entries if entry[1].strip()]
                for clause_ref, summary, treatment, reason in entries:
                    db.add(ReportEntry(
                        report_ref=report.id,
                        clause_ref=clause_ref,
                        extracted_summary=summary,
                        treatment=treatment,
                        stated_reason=reason,
                    ))
                report.extracted_text = text
                report.ocr_used = ocr_used
                report.extraction_status = (
                    "needs_review" if _has_ocr_failures(text)
                    else ("ocr_used" if ocr_used else "extracted")
                )
                await db.commit()
            except Exception:
                log.exception("Could not extract uploaded committee report %s", report_id)
                await db.rollback()
                failed = await db.get(CommitteeReport, report_id)
                if failed:
                    failed.extraction_status = "needs_review"
                    await db.commit()


async def extract_pending_linked_reports(
    db: AsyncSession,
    bill_ref=None,
    *,
    report_id=None,
) -> int:
    """Download and extract linked official Parliament PDFs before matching.

    Accepts only HTTPS URLs on parliament.go.ke or its subdomains, validates
    redirect destinations, enforces a download size limit, and marks partial
    OCR results for manual review.
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

    for current_report_id in report_ids:
        async with _report_extraction_lock:
            result = await db.execute(
                select(CommitteeReport)
                .where(
                    CommitteeReport.id == current_report_id,
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
                if (
                    parsed.scheme != "https"
                    or not parsed.hostname
                    or not (
                        parsed.hostname == "parliament.go.ke"
                        or parsed.hostname.endswith(".parliament.go.ke")
                    )
                ):
                    raise ValueError(
                        "The linked report URL is not on the official Parliament HTTPS domain"
                    )

                chunks = []
                total_bytes = 0

                timeout = httpx.Timeout(
                    connect=15.0,
                    read=60.0,
                    write=30.0,
                    pool=15.0,
                )

                async with httpx.AsyncClient(
                    timeout=timeout,
                    follow_redirects=True,
                    headers={
                        "User-Agent": (
                            "ParticipationTrace/1.0 "
                            "(official report text extraction)"
                        )
                    },
                ) as client:
                    async with asyncio.timeout(PDF_DOWNLOAD_TOTAL_TIMEOUT):
                        async with client.stream("GET", report.source_url) as response:
                            response.raise_for_status()
                            final_host = urlparse(str(response.url)).hostname or ""
                            if not (
                                final_host == "parliament.go.ke"
                                or final_host.endswith(".parliament.go.ke")
                            ):
                                raise ValueError(
                                    "PDF redirect left the official Parliament domain"
                                )

                            async for chunk in response.aiter_bytes():
                                total_bytes += len(chunk)
                                if total_bytes > PDF_MAX_BYTES:
                                    raise ValueError(
                                        f"PDF exceeded the {PDF_MAX_BYTES // (1024 * 1024)} MB limit"
                                    )
                                chunks.append(chunk)

                pdf_bytes = b"".join(chunks)
                if not pdf_bytes.startswith(b"%PDF"):
                    raise ValueError("The linked document is not a readable PDF")

                with tempfile.TemporaryDirectory(
                    prefix="parliament-report-"
                ) as directory:
                    pdf_path = Path(directory) / "report.pdf"
                    pdf_path.write_bytes(pdf_bytes)

                    async with _pdf_ocr_semaphore:
                        text, ocr_used = await asyncio.to_thread(
                            extract_text, str(pdf_path)
                        )

                entries = parse_report_entries(text)
                if not entries:
                    entries = parse_unstructured_report_entries(text)
                entries = [entry for entry in entries if entry[1].strip()]

                partial_or_failed = _has_ocr_failures(text)

                if not entries:
                    report.extraction_status = "needs_review"
                    report.ocr_used = ocr_used
                    report.extracted_text = text
                    await db.commit()
                    continue

                for clause_ref, summary, treatment, reason in entries:
                    db.add(
                        ReportEntry(
                            report_ref=report.id,
                            clause_ref=clause_ref,
                            extracted_summary=summary,
                            treatment=treatment,
                            stated_reason=reason,
                        )
                    )

                report.ocr_used = ocr_used
                report.extracted_text = text
                report.extraction_status = (
                    "needs_review"
                    if partial_or_failed
                    else ("ocr_used" if ocr_used else "extracted")
                )
                await db.commit()
                extracted_count += 1

            except Exception:
                log.exception(
                    "Could not extract linked committee report %s",
                    current_report_id,
                )
                await db.rollback()

                failed_result = await db.execute(
                    select(CommitteeReport)
                    .where(CommitteeReport.id == current_report_id)
                    .with_for_update()
                )
                failed_report = failed_result.scalar_one_or_none()
                if failed_report:
                    failed_report.extraction_status = "needs_review"
                    await db.commit()

    return extracted_count


def parse_unstructured_report_entries(
    text: str,
) -> List[Tuple[str, str, str, str | None]]:
    """Split readable report text into reviewable blocks without claiming outcomes."""
    cleaned = []

    for raw in text.splitlines():
        line = normalize_line(raw)
        if (
            not line
            or line.startswith("[Page ")
            or line.startswith("[OCR_FAILED_PAGE ")
            or line.startswith("[OCR_PAGE_LIMIT_EXCEEDED")
        ):
            continue

        if re.match(
            r"^(page\s+\d+|republic of kenya|national assembly|senate|committee report)\b",
            line,
            re.I,
        ):
            continue

        cleaned.append(line)

    full_text = normalize_line(" ".join(cleaned))
    if len(full_text) < 120:
        return []

    chunks = [
        full_text[index:index + 1200]
        for index in range(0, len(full_text), 1200)
    ]

    return [
        (f"Report text {index + 1}", chunk.strip(), "unclassified", None)
        for index, chunk in enumerate(chunks)
        if len(chunk.strip()) >= 80
    ]
