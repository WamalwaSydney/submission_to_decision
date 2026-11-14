"""Getting Act texts onto the platform: county Act PDFs, the official-copy fallback, and what is missing."""
import json
import pytest
from sqlalchemy import select

from app.models import ActTrace
from app.scripts import act_library
from tests.test_api import TestSession, client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_routes_workflow import API, add, bill_row, isolated_storage  # noqa: F401

ACT_TEXT = "THE NAIROBI CITY COUNTY ENERGY ACT, 2026. " + "The county shall promote clean energy in every ward. " * 20
OFFICIAL_PDF = "https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/Energy-Act-2026.pdf"


@pytest.mark.asyncio
async def test_without_a_stored_pdf_the_act_links_to_its_official_free_copy(client, db_session):
    county = await add(db_session, bill_row(stage="Assented", title="The Nairobi City County Energy Bill, 2025", institution="Nairobi City County Assembly"))
    national = await add(db_session, bill_row(stage="Assented", title="The Roads Bill, 2025"))
    await add(db_session, ActTrace(bill_ref=county.id, act_title="Energy Act", act_text=ACT_TEXT, act_url=OFFICIAL_PDF, items=[]),
              ActTrace(bill_ref=national.id, act_title="Roads Act", act_text=ACT_TEXT, act_url="https://kenyalaw.org/akn/ke/act/2025/1/eng@2025-01-01",
                       storage_ref="/gone/roads.pdf", items=[]))
    assert client.get(f"{API}/bills/{county.id}/final-act/text").json()["has_pdf"] is True
    moved = client.get(f"{API}/bills/{county.id}/final-act/document", follow_redirects=False)
    assert moved.status_code == 307 and moved.headers["location"] == OFFICIAL_PDF
    # Kenya Law pages are not PDFs anyone's script may fetch, and a stored file that is gone is not a PDF either.
    assert client.get(f"{API}/bills/{national.id}/final-act/text").json()["has_pdf"] is False
    assert client.get(f"{API}/bills/{national.id}/final-act/document", follow_redirects=False).status_code == 404


@pytest.mark.asyncio
async def test_county_act_pdfs_load_onto_the_bill_that_lists_them(db_session, isolated_storage, tmp_path, monkeypatch):
    monkeypatch.setattr(act_library, "async_session", TestSession)
    monkeypatch.setattr(act_library, "pdf_text", lambda path: "short" if "scan" in path.name else ACT_TEXT)
    energy = await add(db_session, bill_row(stage="Assented", title="The Nairobi City County Energy Bill, 2025", bill_house="ncca",
                                            institution="Nairobi City County Assembly",
                                            documents=[{"name": "Energy Act (Nairobi City County Assembly)", "url": OFFICIAL_PDF}]))
    fund = await add(db_session, bill_row(stage="Assented", title="Trans Nzoia Fund Act, 2014", identifier="TNCA/2014/Act-fund", bill_house="tnca"))
    ncca, tnca = tmp_path / "county" / "ncca", tmp_path / "county" / "tnca"
    ncca.mkdir(parents=True), tnca.mkdir()
    (ncca / "energy.pdf").write_bytes(b"%PDF-1.4 energy")
    (ncca / "scan.pdf").write_bytes(b"%PDF-1.4 scan")
    (tnca / "fund.pdf").write_bytes(b"%PDF-1.4 fund")
    (tmp_path / "county" / "nomanifest").mkdir()
    (ncca / "manifest.json").write_text(json.dumps([
        {"file": "energy.pdf", "title": "The Nairobi City County Energy Act 2026", "url": OFFICIAL_PDF},
        {"file": "scan.pdf", "title": "Scanned Act", "url": OFFICIAL_PDF.replace("Energy", "Parks")},  # no bill lists this
        {"file": "missing.pdf", "title": "Not downloaded", "url": "https://nairobiassembly.go.ke/x.pdf"},
    ]))
    (tnca / "manifest.json").write_text(json.dumps([{"file": "fund.pdf", "title": "Fund Act", "url": "https://kenyalaw.org/akn/ke-026/act/2014/1", "bill": "TNCA/2014/Act-fund"}]))
    counts = await act_library.load_county(tmp_path / "county")
    assert counts == {"loaded": 2, "already": 0, "no_bill": 1, "unreadable": 0, "missing_file": 1}
    assert (await act_library.load_county(tmp_path / "county"))["already"] == 2  # a second run changes nothing
    async with TestSession() as session:
        rows = {r.bill_ref: r for r in (await session.execute(select(ActTrace))).scalars()}
    assert rows[energy.id].act_url == OFFICIAL_PDF and rows[energy.id].act_text == ACT_TEXT
    assert rows[fund.id].act_title == "Fund Act"


@pytest.mark.asyncio
async def test_missing_lists_assented_bills_without_act_text(db_session, monkeypatch):
    monkeypatch.setattr(act_library, "async_session", TestSession)
    done = await add(db_session, bill_row(stage="Assented", title="The Done Bill, 2025"))
    linked = await add(db_session, bill_row(stage="Assented", title="The Linked Bill, 2025"))
    await add(db_session, bill_row(stage="Assented", title="The Unfound Bill, 2025"), bill_row(stage="Second Reading", title="The Open Bill, 2025"))
    await add(db_session, ActTrace(bill_ref=done.id, act_text=ACT_TEXT, items=[]),
              ActTrace(bill_ref=linked.id, act_url="https://kenyalaw.org/akn/ke/act/2025/9", items=[]))
    gaps = {g["title"]: g["act_url"] for g in await act_library.missing()}
    assert gaps == {"The Linked Bill, 2025": "https://kenyalaw.org/akn/ke/act/2025/9", "The Unfound Bill, 2025": None}
