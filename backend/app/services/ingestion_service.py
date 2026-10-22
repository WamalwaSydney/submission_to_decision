"""Committee-report extraction with native-text and OCR fallback."""
import os
import re
import tempfile
import logging
from datetime import date, datetime
from pathlib import Path
from typing import List, Tuple
from urllib.parse import urlparse
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import CommitteeReport, ReportEntry

log = logging.getLogger(__name__)


def normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


async def ingest_report(db: AsyncSession, bill_ref: str, institution: str, file_path: str,
                        date_tabled: str | date, *, source_url: str | None = None,
                        source_metadata: dict | None = None, uploaded_by=None) -> CommitteeReport:
    if isinstance(date_tabled, str):
        date_tabled = date.fromisoformat(date_tabled)
    elif isinstance(date_tabled, datetime):
        date_tabled = date_tabled.date()
    text, ocr_used = extract_text(file_path)
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
        import pdfplumber
        pages = []
        with pdfplumber.open(file_path) as pdf:
            for page_number, page in enumerate(pdf.pages, start=1):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    pages.append(f"[Page {page_number}]\n{page_text}")
        text = "\n".join(pages)
        if len(text.strip()) >= 100:
            return text, False
    except Exception:
        pass
    return ocr_extract(file_path), True


def ocr_extract(file_path: str) -> str:
    import pytesseract
    from pdf2image import convert_from_path
    return "\n".join(
        f"[Page {i}]\n{pytesseract.image_to_string(image)}"
        for i, image in enumerate(convert_from_path(file_path), start=1)
    )


CLAUSE_RE = re.compile(r"^(?:clause|section|article|paragraph)\s+([A-Za-z0-9().\-]+)\s*[:\-–—]?\s*(.*)$", re.I)
REASON_RE = re.compile(r"^(?:reason|rationale|justification)\s*[:\-]\s*(.*)$", re.I)
TREATMENT_PATTERNS = (
    ("rejected with reasons", re.compile(r"\b(reject(?:ed|ion)?|not accepted|declined)\b", re.I)),
    ("amended", re.compile(r"\b(amend(?:ed|ment)?|modified|revised)\b", re.I)),
    ("adopted", re.compile(r"\b(adopt(?:ed|ion)?|accepted|approved)\b", re.I)),
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
    return item["ref"], normalize_line(" ".join(item["summary"])), item["treatment"] or "not addressed", item["reason"]


async def extract_pending_linked_reports(db: AsyncSession, bill_ref) -> int:
    """Download and extract linked official Parliament PDFs before matching.

    Only HTTPS URLs on parliament.go.ke (or its subdomains) are accepted. The
    document is size-limited, and extraction status prevents repeated downloads
    for reports that have already been processed or need manual review.
    """
    result = await db.execute(
        select(CommitteeReport).where(
            CommitteeReport.bill_ref == bill_ref,
            CommitteeReport.extraction_status == "pending",
            CommitteeReport.source_url.is_not(None),
        )
    )
    reports = list(result.scalars().all())
    extracted_count = 0
    for report in reports:
        parsed = urlparse(report.source_url or "")
        if parsed.scheme != "https" or not parsed.hostname or not (
            parsed.hostname == "parliament.go.ke" or parsed.hostname.endswith(".parliament.go.ke")
        ):
            report.extraction_status = "needs_review"
            continue

        try:
            chunks = []
            total_bytes = 0
            async with httpx.AsyncClient(timeout=45, follow_redirects=True, headers={"User-Agent": "ParticipationTrace/1.0 (official report text extraction)"}) as client:
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
                text, ocr_used = extract_text(str(pdf_path))
            entries = parse_report_entries(text)
            if not entries:
                entries = parse_unstructured_report_entries(text)
            if not entries:
                report.extraction_status = "needs_review"
                report.ocr_used = ocr_used
                continue

            for clause_ref, summary, treatment, reason in entries:
                if not summary:
                    continue
                db.add(ReportEntry(
                    report_ref=report.id,
                    clause_ref=clause_ref,
                    extracted_summary=summary,
                    treatment=treatment,
                    stated_reason=reason,
                ))
            report.extraction_status = "ocr_used" if ocr_used else "extracted"
            report.ocr_used = ocr_used
            extracted_count += 1
        except Exception:
            # Keep the citizen submission intact; moderators can still inspect
            # the linked PDF and the report remains visibly flagged for review.
            log.exception("Could not extract linked committee report %s", report.id)
            report.extraction_status = "needs_review"

    if reports:
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
