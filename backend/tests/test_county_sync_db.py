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
