"""The data the app loads at start-up stays small: no report texts, and compressed."""
from datetime import date

import pytest

from app.models import CommitteeReport
from tests.test_api import client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_routes_workflow import API, add, bill_row


@pytest.mark.asyncio
async def test_start_up_data_leaves_out_report_texts_and_is_compressed(client, db_session):
    bill = await add(db_session, bill_row(title="The Size Bill, 2026"))
    await add(db_session, CommitteeReport(bill_ref=bill.id, institution="Nairobi City County Assembly", date_tabled=date(2026, 1, 1),
                                          source_document_ref="r", source_url="https://nairobiassembly.go.ke/ncca/r.pdf",
                                          extraction_status="ocr_used", ocr_used=True, is_simulated=False, extracted_text="WORDS " * 100_000))
    response = client.get(f"{API}/bootstrap", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("content-encoding") == "gzip"
    [report] = response.json()["reports"]
    assert "extracted_text" not in report
    assert report["source_verification_status"] == "verified" and report["source_verification_label"] == "Official county assembly source verified"
    assert len(response.content) < 200_000  # the 600 KB report text is not sent


@pytest.mark.asyncio
async def test_report_entries_load_separately_except_those_matched_to_a_submission(client, db_session):
    from app.models import ReportEntry
    bill = await add(db_session, bill_row(title="The Entries Bill, 2026"))
    report = await add(db_session, CommitteeReport(bill_ref=bill.id, institution="National Assembly", date_tabled=date(2026, 1, 1),
                                                   source_document_ref="r", source_url="https://www.parliament.go.ke/r.pdf",
                                                   extraction_status="extracted", ocr_used=False, is_simulated=False))
    simulated = await add(db_session, CommitteeReport(bill_ref=bill.id, institution="National Assembly", date_tabled=date(2026, 1, 1),
                                                      source_document_ref="s", extraction_status="extracted", ocr_used=False, is_simulated=True))
    await add(db_session, ReportEntry(report_ref=report.id, clause_ref="Clause 1", extracted_summary="Real entry", treatment="adopted"),
              ReportEntry(report_ref=simulated.id, clause_ref="Clause 1", extracted_summary="Seed entry", treatment="adopted"))
    assert client.get(f"{API}/bootstrap").json()["report_entries"] == []  # nothing is matched to a submission
    assert [e["extracted_summary"] for e in client.get(f"{API}/report-entries").json()] == ["Real entry"]
