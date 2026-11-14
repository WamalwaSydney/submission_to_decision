"""Committee-report reading: PDF text, OCR fallback, parsing, and linked-report downloads.

PDF tools and downloads are replaced with fakes, so these tests are fast and offline.
"""
import subprocess
import sys
import uuid
from datetime import date, datetime
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models import CommitteeReport, LegislativeItem, ReportEntry
from app.services import ingestion_service as ing
from tests.test_api import TestSession, client, db_session  # noqa: F401  (pytest fixtures)

STRUCTURED = """REPUBLIC OF KENYA
Preamble that is not part of any clause.
Clause 4: Licensing of providers
The committee amended the licence period to five years.
Reason: Stakeholders asked for certainty.
[Page 2]
Clause 7 - Penalties
Rejected by the committee after consultation.
Section 9 Fees
The committee adopted the proposal on fees.
[OCR_FAILED_PAGE 3]
"""
LONG_PROSE = ("The committee received memoranda from many stakeholders on the proposed changes. " * 40).strip()


async def make_bill(db_session, **extra):
    bill = LegislativeItem(title="The Test Bill, 2026", identifier=f"NA/2026/Bill-{uuid.uuid4().hex[:6]}",
                           institution="National Assembly", stage="Committee Stage", documents=[], status_history=[], **extra)
    db_session.add(bill)
    await db_session.commit()
    await db_session.refresh(bill)
    return bill


# ============ Parsing ============

def test_parse_report_entries_reads_clauses_treatments_and_reasons():
    entries = ing.parse_report_entries(STRUCTURED)
    assert [e[0] for e in entries] == ["Clause 4", "Clause 7", "Clause 9"]
    clause4, clause7, clause9 = entries
    assert clause4[1].startswith("Licensing of providers") and clause4[2] == "amended"
    assert clause4[3] == "Stakeholders asked for certainty."
    assert clause7[2] == "rejected with reasons" and clause7[3] is None
    assert clause9[2] == "adopted"
    assert ing.parse_report_entries("No clauses at all here.") == []


def test_unclassified_when_no_treatment_is_recorded():
    [(ref, summary, treatment, reason)] = ing.parse_report_entries("Clause 2\nSome discussion of clause two.")
    assert (ref, treatment, reason) == ("Clause 2", "unclassified", None)
    assert summary == "Some discussion of clause two."


def test_unstructured_reports_split_into_blocks_without_claiming_outcomes():
    text = "Page 1\nREPUBLIC OF KENYA\nNational Assembly\n[Page 1]\n" + LONG_PROSE + "\n[OCR_FAILED_PAGE 2]"
    blocks = ing.parse_unstructured_report_entries(text)
    assert blocks and all(b[2] == "unclassified" and b[3] is None for b in blocks)
    assert blocks[0][0] == "Report text 1"
    assert "REPUBLIC" not in blocks[0][1]
    assert all(len(b[1]) <= 1200 for b in blocks)
    assert ing.parse_unstructured_report_entries("Too short to be a report.") == []


def test_normalize_line_and_failure_markers():
    assert ing.normalize_line("  a  b\t c ") == "a b c"
    assert ing._has_ocr_failures("ok [OCR_FAILED_PAGE 2]")
    assert ing._has_ocr_failures("[OCR_PAGE_LIMIT_EXCEEDED pages=200 limit=100]")
    assert ing._has_ocr_failures("[OCR_TOTAL_TIMEOUT pages_completed=3]")
    assert not ing._has_ocr_failures("clean text")


# ============ Text extraction ============

def _completed(stdout="", returncode=0, stderr=""):
    return subprocess.CompletedProcess([], returncode, stdout, stderr)


def test_native_pdf_text_is_used_when_there_is_enough(monkeypatch):
    monkeypatch.setattr(ing.subprocess, "run", lambda *a, **k: _completed("x" * 150))
    monkeypatch.setattr(ing, "ocr_extract", lambda path: pytest.fail("OCR should not run"))
    assert ing.extract_text("report.pdf") == ("x" * 150, False)


def test_short_or_failed_native_text_falls_back_to_ocr(monkeypatch):
    monkeypatch.setattr(ing, "ocr_extract", lambda path: "ocr text")
    monkeypatch.setattr(ing.subprocess, "run", lambda *a, **k: _completed("tiny"))
    assert ing.extract_text("scan.pdf") == ("ocr text", True)

    def broken(*a, **k):
        raise subprocess.CalledProcessError(1, "pdftotext")
    monkeypatch.setattr(ing.subprocess, "run", broken)
    assert ing.extract_text("scan.pdf") == ("ocr text", True)


def test_page_count_is_read_from_pdfinfo(monkeypatch):
    monkeypatch.setattr(ing.subprocess, "run", lambda *a, **k: _completed("Title: x\nPages:   12\n"))
    assert ing._get_pdf_page_count("r.pdf") == 12
    monkeypatch.setattr(ing.subprocess, "run", lambda *a, **k: _completed("Title: x\n"))
    with pytest.raises(ValueError):
        ing._get_pdf_page_count("r.pdf")


def test_pdf_commands_return_output_and_are_killed_on_timeout():
    # Python itself stands in for pdftotext, so the test runs on Windows as well as Linux.
    done = ing._run_pdf_command([sys.executable, "-c", "print('hello')"], timeout=5, text=True)
    assert done.returncode == 0 and done.stdout.strip() == "hello"
    with pytest.raises(subprocess.TimeoutExpired):
        ing._run_pdf_command([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.2)


def test_render_page_returns_the_image_or_explains_the_failure(monkeypatch, tmp_path):
    prefix = str(tmp_path / "page_1")

    def renders(args, timeout, text=False):
        Path(f"{prefix}.jpg").write_bytes(b"jpeg")
        return _completed(b"", 0, b"")
    monkeypatch.setattr(ing, "_run_pdf_command", renders)
    assert ing._render_page("r.pdf", 1, prefix, 150) == f"{prefix}.jpg"

    monkeypatch.setattr(ing, "_run_pdf_command", lambda args, timeout, text=False: _completed(b"", 1, b"bad page"))
    Path(f"{prefix}.jpg").unlink()
    with pytest.raises(RuntimeError, match="could not render page 1"):
        ing._render_page("r.pdf", 1, prefix, 150)


def test_ocr_page_returns_text_and_always_removes_the_image(monkeypatch, tmp_path):
    image = tmp_path / "page_1.jpg"

    def render(file_path, page_number, prefix, dpi):
        image.write_bytes(b"jpeg")
        return str(image)
    monkeypatch.setattr(ing, "_render_page", render)

    monkeypatch.setattr(ing, "_run_pdf_command", lambda args, timeout, text=False: _completed(" page text \n"))
    assert ing._ocr_page("r.pdf", 1, str(tmp_path)) == "page text"
    assert not image.exists()

    monkeypatch.setattr(ing, "_run_pdf_command", lambda args, timeout, text=False: _completed("", 1, "tesseract crashed"))
    with pytest.raises(RuntimeError, match="exited 1"):
        ing._ocr_page("r.pdf", 1, str(tmp_path))
    assert not image.exists()

    monkeypatch.setattr(ing, "_run_pdf_command", lambda args, timeout, text=False: _completed("   "))
    with pytest.raises(RuntimeError, match="no text"):
        ing._ocr_page("r.pdf", 1, str(tmp_path))


def test_ocr_keeps_good_pages_and_marks_failed_ones(monkeypatch):
    monkeypatch.setattr(ing, "_get_pdf_page_count", lambda path: 3)

    def ocr_page(path, number, directory):
        if number == 2:
            raise RuntimeError("unreadable")
        return f"text {number}"
    monkeypatch.setattr(ing, "_ocr_page", ocr_page)
    out = ing.ocr_extract("r.pdf")
    assert "[Page 1]\ntext 1" in out and "[OCR_FAILED_PAGE 2]" in out and "[Page 3]\ntext 3" in out


def test_ocr_records_page_limit_and_total_timeout(monkeypatch):
    monkeypatch.setattr(ing, "_get_pdf_page_count", lambda path: 5)
    monkeypatch.setattr(ing, "_ocr_page", lambda path, number, directory: f"text {number}")
    monkeypatch.setattr(ing, "MAX_OCR_PAGES", 2)
    out = ing.ocr_extract("r.pdf")
    assert out.startswith("[OCR_PAGE_LIMIT_EXCEEDED pages=5 limit=2]") and "[Page 3]" not in out

    monkeypatch.setattr(ing, "OCR_TOTAL_TIMEOUT", -1)
    assert "[OCR_TOTAL_TIMEOUT pages_completed=0]" in ing.ocr_extract("r.pdf")


# ============ Saving reports ============

@pytest.mark.asyncio
async def test_ingest_report_saves_entries_and_status(db_session, monkeypatch, tmp_path):
    bill = await make_bill(db_session)
    pdf = tmp_path / "finance-report.pdf"
    pdf.write_bytes(b"%PDF")

    monkeypatch.setattr(ing, "extract_text", lambda path: (STRUCTURED.replace("[OCR_FAILED_PAGE 3]", ""), False))
    report = await ing.ingest_report(db_session, bill.id, "National Assembly", str(pdf), "2026-03-01", source_url="https://www.parliament.go.ke/r.pdf")
    assert report.extraction_status == "extracted" and report.date_tabled == date(2026, 3, 1)
    assert report.source_document_ref == "finance-report.pdf"
    entries = (await db_session.execute(select(ReportEntry).where(ReportEntry.report_ref == report.id))).scalars().all()
    assert len(entries) == 3

    monkeypatch.setattr(ing, "extract_text", lambda path: (STRUCTURED, True))
    report = await ing.ingest_report(db_session, bill.id, "National Assembly", str(pdf), datetime(2026, 3, 2, 9, 0))
    assert report.extraction_status == "needs_review" and report.date_tabled == date(2026, 3, 2)

    monkeypatch.setattr(ing, "extract_text", lambda path: ("Clause 1\nText", True))
    report = await ing.ingest_report(db_session, bill.id, "National Assembly", str(pdf), date(2026, 3, 3))
    assert report.extraction_status == "ocr_used"


async def _report(db_session, bill, **fields):
    report = CommitteeReport(bill_ref=bill.id, institution="National Assembly", date_tabled=date(2026, 3, 1),
                             source_document_ref="r.pdf", extraction_status="pending", ocr_used=False, **fields)
    db_session.add(report)
    await db_session.commit()
    await db_session.refresh(report)
    return report


async def _status(report_id):
    async with TestSession() as fresh:
        report = await fresh.get(CommitteeReport, report_id)
        entries = (await fresh.execute(select(ReportEntry).where(ReportEntry.report_ref == report_id))).scalars().all()
        return report.extraction_status, len(entries)


@pytest.mark.asyncio
async def test_uploaded_reports_are_extracted_in_the_background(db_session, monkeypatch):
    import app.database
    monkeypatch.setattr(app.database, "async_session", TestSession)
    bill = await make_bill(db_session)

    good = await _report(db_session, bill, source_storage_ref="/tmp/r.pdf")
    monkeypatch.setattr(ing, "extract_text", lambda path: (STRUCTURED.replace("[OCR_FAILED_PAGE 3]", ""), True))
    await ing.process_uploaded_report(good.id)
    assert await _status(good.id) == ("ocr_used", 3)

    # Unstructured prose still produces reviewable blocks.
    prose = await _report(db_session, bill, source_storage_ref="/tmp/p.pdf")
    monkeypatch.setattr(ing, "extract_text", lambda path: (LONG_PROSE, False))
    await ing.process_uploaded_report(prose.id)
    status, count = await _status(prose.id)
    assert status == "extracted" and count >= 1

    # A failure marks the report for review instead of losing it.
    broken = await _report(db_session, bill, source_storage_ref="/tmp/b.pdf")

    def fail(path):
        raise RuntimeError("corrupt PDF")
    monkeypatch.setattr(ing, "extract_text", fail)
    await ing.process_uploaded_report(broken.id)
    assert await _status(broken.id) == ("needs_review", 0)

    # Already-processed and missing reports are left alone.
    await ing.process_uploaded_report(good.id)
    await ing.process_uploaded_report(uuid.uuid4())
    assert await _status(good.id) == ("ocr_used", 3)


class _FakeResponse:
    def __init__(self, url, chunks):
        self.url, self._chunks = url, chunks

    def raise_for_status(self):
        pass

    async def aiter_bytes(self):
        for chunk in self._chunks:
            yield chunk


def fake_download(chunks, final_url=None):
    class Stream:
        def __init__(self, url):
            self.response = _FakeResponse(final_url or url, chunks)

        async def __aenter__(self):
            return self.response

        async def __aexit__(self, *exc):
            return False

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url):
            return Stream(url)
    return Client


@pytest.mark.asyncio
async def test_linked_parliament_reports_are_downloaded_and_read(db_session, monkeypatch):
    bill = await make_bill(db_session)
    assert await ing.extract_pending_linked_reports(db_session) == 0  # nothing to scope to

    report = await _report(db_session, bill, source_url="https://www.parliament.go.ke/sites/default/files/report.pdf")
    monkeypatch.setattr(ing.httpx, "AsyncClient", fake_download([b"%PDF-1.7 ", b"rest of file"]))
    monkeypatch.setattr(ing, "extract_text", lambda path: (STRUCTURED, False))
    assert await ing.extract_pending_linked_reports(db_session, bill.id) == 1
    assert await _status(report.id) == ("needs_review", 3)  # OCR failure marker on page 3

    clean = await _report(db_session, bill, source_url="https://www.parliament.go.ke/clean.pdf")
    monkeypatch.setattr(ing, "extract_text", lambda path: (LONG_PROSE, True))
    assert await ing.extract_pending_linked_reports(db_session, report_id=clean.id) == 1
    status, count = await _status(clean.id)
    assert status == "ocr_used" and count >= 1


@pytest.mark.asyncio
@pytest.mark.parametrize("url, chunks, final_url, limit", [
    ("http://www.parliament.go.ke/r.pdf", [b"%PDF"], None, None),                  # not HTTPS
    ("https://evil.example.com/r.pdf", [b"%PDF"], None, None),                     # not Parliament
    ("https://www.parliament.go.ke/r.pdf", [b"%PDF"], "https://evil.example.com/r.pdf", None),  # redirected away
    ("https://www.parliament.go.ke/r.pdf", [b"<html>not a pdf</html>"], None, None),
    ("https://www.parliament.go.ke/r.pdf", [b"%PDF", b"x" * 64], None, 32),       # too large
])
async def test_unsafe_or_bad_linked_reports_are_marked_for_review(db_session, monkeypatch, url, chunks, final_url, limit):
    bill = await make_bill(db_session)
    report = await _report(db_session, bill, source_url=url)
    monkeypatch.setattr(ing.httpx, "AsyncClient", fake_download(chunks, final_url))
    monkeypatch.setattr(ing, "extract_text", lambda path: (STRUCTURED, False))
    if limit:
        monkeypatch.setattr(ing, "PDF_MAX_BYTES", limit)
    assert await ing.extract_pending_linked_reports(db_session, bill.id) == 0
    assert await _status(report.id) == ("needs_review", 0)


@pytest.mark.asyncio
async def test_linked_report_with_no_readable_entries_needs_review(db_session, monkeypatch):
    bill = await make_bill(db_session)
    report = await _report(db_session, bill, source_url="https://www.parliament.go.ke/empty.pdf")
    monkeypatch.setattr(ing.httpx, "AsyncClient", fake_download([b"%PDF"]))
    monkeypatch.setattr(ing, "extract_text", lambda path: ("short", True))
    assert await ing.extract_pending_linked_reports(db_session, bill.id) == 0
    assert await _status(report.id) == ("needs_review", 0)
