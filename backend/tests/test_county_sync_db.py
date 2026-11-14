"""County sync end to end with a fake HTTP transport: fetching, Kenya Law Acts,
storing bills without overwriting Clerk's Office stages, and failure handling."""
import json
from datetime import date

import httpx
import pytest
from sqlalchemy import text

from app.scripts import sync_county_bills as county_sync
from app.scripts.sync_county_bills import COUNTIES, CountyBill, documents_for, history_for, identifier_for
from tests.test_api import TEST_DB_URL, TestSession, db_session, test_engine  # noqa: F401  (pytest fixtures)

NAIROBI, TRANS_NZOIA = COUNTIES

NAIROBI_PAGE = """
<a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2025/Energy.pdf">The Nairobi City County Energy Bill, 2025 (Assembly Bill No.4 of 2025)</a>
<a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2024/Markets.pdf">The Nairobi City County Markets Bill, 2024</a>
<a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2024/Gazette.pdf">Gazette supplement</a>
"""
TRANS_NZOIA_PAGE = """
<a href="http://transnzoiaassembly.go.ke/downloads?download=12">transnzoia_county_water_bill_2024.pdf</a>
<a href="http://transnzoiaassembly.go.ke/downloads?download=13">county_roads_bill_2023.pdf</a>
"""
KENYA_LAW_NAIROBI = """
<a href="/akn/ke-047/act/2024/3/eng@2024-06-01">The Nairobi City County Markets Act, 2024</a>
<a href="/akn/ke-047/act/2019/1/eng@2019-05-01">The Nairobi City County Old Act, 2019</a>
<a href="/akn/ke-047/act/2020/2/eng">   </a>
"""


def transport(routes):
    def handler(request):
        for needle, response in routes.items():
            if needle in str(request.url):
                return response() if callable(response) else httpx.Response(200, text=response, request=request)
        return httpx.Response(404, request=request)
    return httpx.MockTransport(handler)


def patch_client(monkeypatch, routes):
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real(*args, transport=transport(routes), **kwargs)
    monkeypatch.setattr(county_sync.httpx, "AsyncClient", factory)


def test_identifiers_documents_and_history_for_bills_and_acts():
    act_only = CountyBill(title="The Nairobi City County Old Act, 2019", year=2019, number=None,
                          act_url="https://new.kenyalaw.org/akn/ke-047/act/2019/1", act_title="The Nairobi City County Old Act, 2019", act_date=date(2019, 5, 1))
    assert identifier_for(NAIROBI, act_only).startswith("NCCA/2019/Act-")
    undated = CountyBill(title="The Nairobi City County Parks Bill", year=None, number=None, document_url="https://nairobiassembly.go.ke/x.pdf")
    assert "/undated/Bill-" in identifier_for(NAIROBI, undated)
    assert [d["url"] for d in documents_for(NAIROBI, act_only)] == [act_only.act_url]
    [assented] = history_for(NAIROBI, act_only)
    assert assented["date"] == "2019-05-01" and assented["stage"] == county_sync.ASSENTED_STAGE
    [listed] = history_for(NAIROBI, undated)
    assert listed["date"] == "Undated" and listed["stage"] == county_sync.LISTED_STAGE
    no_date = CountyBill(title="X Act", year=None, number=None, act_url="u", act_title="X Act")
    assert history_for(NAIROBI, no_date)[0]["date"] == "Undated"


@pytest.mark.asyncio
async def test_fetch_merges_kenya_law_acts_and_survives_kenya_law_outages():
    async with httpx.AsyncClient(transport=transport({"nairobiassembly": NAIROBI_PAGE, "kenyalaw": KENYA_LAW_NAIROBI})) as client:
        bills = await county_sync.fetch_county(client, NAIROBI)
    by_title = {b.title: b for b in bills}
    assert by_title["The Nairobi City County Markets Bill, 2024"].act_date == date(2024, 6, 1)
    assert "The Nairobi City County Old Act, 2019" in by_title  # an Act whose bill is no longer listed
    assert "Gazette supplement" not in by_title

    def down():
        raise httpx.ConnectError("Kenya Law is down")
    async with httpx.AsyncClient(transport=transport({"transnzoia": TRANS_NZOIA_PAGE, "kenyalaw": down})) as client:
        bills = await county_sync.fetch_county(client, TRANS_NZOIA)
    titles = {b.title for b in bills}
    assert "The Trans Nzoia County Water Bill, 2024" in titles and "The Trans Nzoia County Roads Bill, 2023" in titles


@pytest.mark.asyncio
async def test_sync_stores_bills_and_keeps_clerk_stages(db_session, monkeypatch):
    patch_client(monkeypatch, {"nairobiassembly": NAIROBI_PAGE, "transnzoia": TRANS_NZOIA_PAGE, "kenyalaw": KENYA_LAW_NAIROBI})
    async with test_engine.begin() as conn:
        first = await county_sync.sync_counties(conn)
    assert first[NAIROBI.institution][0] == 3 and first[TRANS_NZOIA.institution][0] >= 2

    energy = "NCCA/2025/Bill-004"
    async with test_engine.begin() as conn:
        await conn.execute(text("UPDATE legislative_items SET stage='Second Reading', documents=CAST(:docs AS jsonb) WHERE identifier=:id"),
                           {"id": energy, "docs": json.dumps([{"name": "Clerk upload", "url": "https://nairobiassembly.go.ke/clerk.pdf"}])})
        second = await county_sync.sync_counties(conn)
    assert second[NAIROBI.institution] == (0, 3)
    async with TestSession() as session:
        row = (await session.execute(text("SELECT stage, documents FROM legislative_items WHERE identifier=:id"), {"id": energy})).first()
        markets = (await session.execute(text("SELECT stage FROM legislative_items WHERE title LIKE 'The Nairobi City County Markets%'"))).scalar_one()
    assert row.stage == "Second Reading"  # recorded by the Clerk's Office, kept
    assert {d["name"] for d in row.documents} >= {"Clerk upload", "Official bill document (Nairobi City County Assembly)"}
    assert markets == county_sync.ASSENTED_STAGE


@pytest.mark.asyncio
async def test_one_failing_county_does_not_stop_the_other(db_session, monkeypatch):
    patch_client(monkeypatch, {"nairobiassembly": NAIROBI_PAGE, "kenyalaw": "<html></html>"})  # Trans Nzoia returns 404
    async with test_engine.begin() as conn:
        results = await county_sync.sync_counties(conn)
    assert results[TRANS_NZOIA.institution] is None and results[NAIROBI.institution] is not None


@pytest.mark.asyncio
async def test_command_line_entry_point(db_session, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert await county_sync.main() == 1  # no database configured

    monkeypatch.setenv("DATABASE_URL", TEST_DB_URL)

    async def ok(conn):
        return {NAIROBI.institution: (1, 0), TRANS_NZOIA.institution: (0, 2)}

    async def assign(conn):
        return {}
    import app.committee_assignment
    monkeypatch.setattr(county_sync, "sync_counties", ok)
    monkeypatch.setattr(app.committee_assignment, "assign_committees", assign)
    assert await county_sync.main() == 0

    async def partly(conn):
        return {NAIROBI.institution: None, TRANS_NZOIA.institution: (0, 2)}
    monkeypatch.setattr(county_sync, "sync_counties", partly)
    assert await county_sync.main() == 1


async def _county_bill(conn, identifier, title, year, number=None, stage="Published by the assembly"):
    import uuid
    bill_id = uuid.uuid4()
    await conn.execute(text("""INSERT INTO legislative_items (id, title, identifier, institution, stage, documents, status_history, is_simulated, bill_house, bill_number, bill_year)
        VALUES (:id, :title, :identifier, 'Nairobi City County Assembly', :stage, CAST('[]' AS jsonb), CAST('[]' AS json), false, 'ncca', :number, :year)"""),
        {"id": bill_id, "title": title, "identifier": identifier, "stage": stage, "number": number, "year": year})
    return bill_id


def _report(title, url, number=None, year=None):
    return {"institution": NAIROBI.institution, "date_tabled": date(2026, 4, 8), "title": title, "committee_name": None,
            "committee_url": NAIROBI.reports_url, "bill_house": "ncca", "bill_number": number, "bill_year": year, "source_url": url}


@pytest.mark.asyncio
async def test_county_reports_link_to_county_bills_only(db_session):
    from app.scripts.sync_legislation import link_unlinked_reports
    async with test_engine.begin() as conn:
        energy = await _county_bill(conn, "NCCA/2025/Bill-004", "The Nairobi City County Clean Energy Bill, 2025", 2025, 4)
        health = await _county_bill(conn, "NCCA/2025/Bill-h", "The Nairobi City County Health Services Bill, 2025", 2025)
        rows = [_report("REPORT ON THE ENERGY BILL (ASSEMBLY BILL NO. 4 OF 2025)", "https://nairobiassembly.go.ke/a.pdf", 4, 2025),
                _report("REPORT OF THE COMMITTEE ON LIAISON ON CONSIDERATION OF THE NAIROBI CITY COUNTY HEALTH SERVICES BILL, 2025", "https://nairobiassembly.go.ke/b.pdf"),
                _report("REPORT ON CONSIDERATION OF THE PARKS BILL, 2025", "https://nairobiassembly.go.ke/c.pdf"),
                _report("REPORT ON THE NAIROBI CITY COUNTY BILL", "https://nairobiassembly.go.ke/d.pdf")]
        assert await county_sync.upsert_county_reports(conn, NAIROBI, rows) == (4, 2)
        # A person links the parks report by hand; the next sync keeps that link and adds no copies.
        await conn.execute(text("UPDATE committee_reports SET bill_ref=:bill WHERE source_url='https://nairobiassembly.go.ke/c.pdf'"), {"bill": health})
        assert await county_sync.upsert_county_reports(conn, NAIROBI, rows) == (0, 2)
        assert await link_unlinked_reports(conn) == 0  # the national linker leaves county reports alone
        links = dict((await conn.execute(text("SELECT source_url, bill_ref FROM committee_reports WHERE bill_house='ncca'"))).all())
    assert links["https://nairobiassembly.go.ke/a.pdf"] == energy and links["https://nairobiassembly.go.ke/b.pdf"] == health
    assert links["https://nairobiassembly.go.ke/c.pdf"] == health and links["https://nairobiassembly.go.ke/d.pdf"] is None


@pytest.mark.asyncio
async def test_an_act_stored_under_another_spelling_is_not_stored_twice(db_session):
    async with test_engine.begin() as conn:
        await _county_bill(conn, "NCCA/2017/Act-old", "Nairobi City County Cultural Heritage Act, 2017", 2017, stage="Assented")
        act = CountyBill(title="The Nairobi City County Culture Heritage Act, 2017", year=2017, number=None,
                         act_url="https://nairobiassembly.go.ke/ncca/wp-content/uploads/acts/2017/Culture.pdf",
                         act_title="The Nairobi City County Culture Heritage Act, 2017", act_source=NAIROBI.institution)
        assert await county_sync.upsert_county_bills(conn, NAIROBI, [act]) == (0, 1)
        assert await county_sync.upsert_county_bills(conn, NAIROBI, [act]) == (0, 1)
        new = CountyBill(title="The Nairobi City County Markets Act, 2017", year=2017, number=None,
                         act_url="https://nairobiassembly.go.ke/m.pdf", act_title="Markets Act")
        assert await county_sync.upsert_county_bills(conn, NAIROBI, [new]) == (1, 0)
        rows = (await conn.execute(text("SELECT title, documents FROM legislative_items WHERE bill_house='ncca' ORDER BY title"))).all()
    assert [r.title for r in rows] == ["Nairobi City County Cultural Heritage Act, 2017", "The Nairobi City County Markets Act, 2017"]
    assert [d["name"] for d in rows[0].documents] == ["The Nairobi City County Culture Heritage Act, 2017 (Nairobi City County Assembly)"]


ACTS_PAGE = """<table><tr><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/Energy.pdf">The Nairobi City County Energy Act 2026</a></td><td>2nd September, 2026</td></tr></table>"""
PAPERS_PAGE = """<table><tr><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/paperlaid/2026/e.pdf">REPORT ON THE CONSIDERATION OF THE NAIROBI CITY COUNTY ENERGY BILL, 2025 (ASSEMBLY BILL NO. 4 OF 2025)</a></td><td>8th April, 2026</td></tr></table>"""


@pytest.mark.asyncio
async def test_sync_adds_acts_and_reports_and_survives_failing_pages(db_session, monkeypatch):
    patch_client(monkeypatch, {"/acts/": ACTS_PAGE, "papers-laid": PAPERS_PAGE, "nairobiassembly": NAIROBI_PAGE,
                               "transnzoia": TRANS_NZOIA_PAGE, "kenyalaw": "<html></html>"})
    async with test_engine.begin() as conn:
        await county_sync.sync_counties(conn)
    async with TestSession() as session:
        energy = (await session.execute(text("SELECT id, stage, documents FROM legislative_items WHERE identifier='NCCA/2025/Bill-004'"))).first()
        report = (await session.execute(text("SELECT bill_ref, extraction_status, date_tabled FROM committee_reports"))).first()
    assert energy.stage == county_sync.ASSENTED_STAGE
    assert "The Nairobi City County Energy Act 2026 (Nairobi City County Assembly)" in {d["name"] for d in energy.documents}
    assert report.bill_ref == energy.id and report.extraction_status == "pending" and report.date_tabled == date(2026, 4, 8)

    patch_client(monkeypatch, {"/acts/": lambda: httpx.Response(500), "papers-laid": lambda: httpx.Response(500),
                               "nairobiassembly": NAIROBI_PAGE, "transnzoia": TRANS_NZOIA_PAGE, "kenyalaw": "<html></html>"})
    async with test_engine.begin() as conn:
        results = await county_sync.sync_counties(conn)
    assert results[NAIROBI.institution] is not None  # bills still sync when the Acts and reports pages fail
