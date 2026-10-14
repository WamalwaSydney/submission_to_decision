"""Committee-report extraction with native-text and OCR fallback."""
import os
import re
from datetime import date, datetime
from typing import List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import CommitteeReport, ReportEntry


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
