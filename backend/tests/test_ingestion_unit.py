from pathlib import Path
from app.services.ingestion_service import parse_report_entries, extract_text


def test_parser_handles_clause_section_reason_and_treatment():
    text = Path('evaluation/fixtures/native_report.txt').read_text()
    rows = parse_report_entries(text)
    assert rows[0][0] == 'Clause 4'
    assert rows[0][2] == 'adopted'
    assert rows[0][3] == 'The measure improves transition support.'
    assert rows[1][2] == 'rejected with reasons'


def test_bill_clause_text_does_not_infer_committee_treatment():
    text = "Clause 6: Flexible working hours\nAn employer may reject an application for flexible working arrangements."
    rows = parse_report_entries(text)
    assert rows[0][0] == 'Clause 6'
    assert rows[0][2] == 'unclassified'


def test_native_fixture_extracts_without_ocr():
    text, ocr_used = extract_text('evaluation/fixtures/native_report.pdf')
    assert 'Clause 4' in text
    assert ocr_used is False


def test_scanned_fixture_exists_for_ocr_regression():
    assert Path('evaluation/fixtures/scanned_report.pdf').exists()
    assert Path('evaluation/fixtures/scanned_report.png').exists()
