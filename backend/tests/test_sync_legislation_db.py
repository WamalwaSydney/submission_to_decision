"""Parliament sync: page discovery, retries, PDFs, committees, reports, and the database
upserts for bills, notices and reports. HTTP and pdftotext are faked; nothing goes online."""
import json
import subprocess
from datetime import date

import httpx
import pytest
from sqlalchemy import text

from app.scripts import sync_legislation as sync
from app.scripts.sync_legislation import BillRow, Committee, NoticeRow
from tests.test_api import TEST_DB_URL, TestSession, db_session, test_engine  # noqa: F401  (pytest fixtures)


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    async def instant(seconds):
        return None
    monkeypatch.setattr(sync.asyncio, "sleep", instant)


def transport(routes):
    def handler(request):
        url = str(request.url)
        for needle, response in routes.items():
            if needle in url:
                if callable(response):
                    return response(request)
                if isinstance(response, bytes):
                    return httpx.Response(200, content=response, request=request)
                return httpx.Response(200, text=response, request=request)
        return httpx.Response(404, request=request)
    return httpx.MockTransport(handler)


REAL_ASYNC_CLIENT = httpx.AsyncClient


async def prepare_schema(conn):
    """The sync adds its indexes and columns itself (main() does this first)."""
    for statement in filter(None, (s.strip() for s in sync.SCHEMA_SQL.split(";"))):
        await conn.execute(text(statement))


def bill(identifier="NA/2026/Bill-012", **fields):
    values = dict(title="The Water Bill, 2026", identifier=identifier, house="na", number=12, year=2026, stage="First Reading",
                  source_url="https://www.parliament.go.ke/tracker.pdf", source_file_ref=None)
    values.update(fields)
    return BillRow(**values)


# ============ Fetching ============

@pytest.mark.asyncio
async def test_get_retries_then_gives_up():
    calls = {"n": 0}

    def flaky(request):
        calls["n"] += 1
        return httpx.Response(503 if calls["n"] < 3 else 200, text="ok", request=request)
    async with httpx.AsyncClient(transport=transport({"flaky": flaky, "down": lambda r: httpx.Response(500, request=r)})) as client:
        assert (await sync.get(client, "https://www.parliament.go.ke/flaky")).text == "ok"
        with pytest.raises(httpx.HTTPStatusError):
            await sync.get(client, "https://www.parliament.go.ke/down")
    assert calls["n"] == 3


def test_tracker_pdfs_are_found_and_the_newest_is_chosen():
    html = """
    <a href="/sites/default/files/2026-01/Tracker.pdf">Bills tracker 5th January 2026</a>
    <a href="/sites/default/files/2026-03/Tracker.pdf" title="Bills Tracker">as at 3 March, 2026</a>
    <a href="/sites/default/files/2025-11/other.pdf">Order Paper</a>
    <a href="/sites/default/files/2026-02/tracker-feb.pdf">Tracker</a>
    <a href="/about">About</a>"""
    links = sync.pdf_links(html, sync.TRACKER_INDEX)
    assert len(links) == 4
    url, as_at = sync.choose_latest_tracker(html)
    assert url.endswith("2026-03/Tracker.pdf") and as_at == date(2026, 3, 3)
    assert sync.link_date("https://x/sites/default/files/2026-02/t.pdf", "Tracker") == date(2026, 2, 1)
    assert sync.link_date("https://x/t.pdf", "Tracker") == date.min
    with pytest.raises(RuntimeError, match="no tracker PDF"):
        sync.choose_latest_tracker('<a href="/x.pdf">Order paper</a>')


def test_pdf_text_extraction_and_its_errors(monkeypatch):
    def fake_run(args, **kwargs):
        with open(args[-1], "w", encoding="utf-8") as out:
            out.write(f"text via {args[1]}")
    monkeypatch.setattr(sync.subprocess, "run", fake_run)
    assert sync.extract_pdf(b"%PDF") == "text via -layout"
    assert sync.extract_pdf(b"%PDF", layout=False) == "text via -raw"

    def missing(*a, **k):
        raise FileNotFoundError("pdftotext")
    monkeypatch.setattr(sync.subprocess, "run", missing)
    with pytest.raises(RuntimeError, match="pdftotext is required"):
        sync.extract_pdf(b"%PDF")

    def broken(*a, **k):
        raise subprocess.CalledProcessError(1, "pdftotext", stderr="damaged")
    monkeypatch.setattr(sync.subprocess, "run", broken)
    with pytest.raises(RuntimeError, match="damaged"):
        sync.extract_pdf(b"%PDF")


def test_notice_links_are_found_on_parliament_pages_only():
    html = """
    <a href="/the-national-assembly/house-business/invitation-submission-memoranda-water-bill">Invitation</a>
    <a href="https://evil.example.com/memoranda">Memoranda elsewhere</a>
    <a href="https://www.parliament.go.ke/sites/default/files/memo.pdf">Memoranda PDF</a>"""
    urls = sync.discover_notice_urls(html)
    assert urls == ["https://www.parliament.go.ke/the-national-assembly/house-business/invitation-submission-memoranda-water-bill",
                    "https://www.parliament.go.ke/sites/default/files/memo.pdf"]


@pytest.mark.asyncio
async def test_notice_pages_are_discovered_from_landing_pages_and_search():
    page = '<a href="/index.php/the-senate/public-hearings-memoranda-roads-bill">Roads</a><a href="/submission-memoranda">old</a>'

    def search(request):
        if "page=0" in str(request.url) and "invitation" in str(request.url):
            return httpx.Response(200, text='<a href="/the-national-assembly/memoranda-health-bill">Health</a>', request=request)
        return httpx.Response(200, text="", request=request)
    routes = {"/search/node": search, "/the-national-assembly": lambda r: httpx.Response(500, request=r), "parliament.go.ke": page}
    async with httpx.AsyncClient(transport=transport(routes)) as client:
        urls = await sync.discover_notice_pages(client)
    assert "https://www.parliament.go.ke/the-senate/public-hearings-memoranda-roads-bill" in urls
    assert "https://www.parliament.go.ke/the-national-assembly/memoranda-health-bill" in urls
    assert not any(u.endswith("/submission-memoranda") for u in urls)


# ============ Committees and reports ============

COMMITTEE_NAV = """
<div id="quicktabs-the_national_assembly_committees">
  <a href="#">Departmental Committees</a>
  <a href="/index.php/the-national-assembly/committees/health">Departmental Committee on Health</a>
  <a href="/the-national-assembly/committees/health">Health</a>
  <a href="https://evil.example.com/finance">Finance</a>
  <a href="/">Committee</a>
  <a href="#tab">Education</a>
  <ul><li class="menu-item--expanded">Other Committees (2017-2022)<a href="/old">Old Committee on Roads</a></li></ul>
  <a href="/the-national-assembly/committees/finance">Finance and National Planning</a>
</div>"""


def test_committee_directory_keeps_one_entry_per_current_committee():
    committees = sync.discover_committees(COMMITTEE_NAV)
    names = [c.name for c in committees]
    assert names == ["Departmental Committee on Health", "Finance and National Planning"]
    assert committees[0].url == "https://www.parliament.go.ke/the-national-assembly/committees/health"
    fallback = sync.discover_committees('<nav class="menu--committees"><a href="/c/energy">Energy</a></nav>')
    assert [c.name for c in fallback] == ["Energy"]


def test_committee_report_links_read_bill_references():
    committee = Committee("Health", "https://www.parliament.go.ke/c/health", "National Assembly")
    html = """
    <ul><li>Committee Reports
      <a href="/sites/default/files/2026-02/report.pdf">Report on the Mental Health Bill (National Assembly Bills No. 12 of 2026)</a>
      <a href="/sites/default/files/2026-02/report.pdf">Duplicate link</a>
      <a href="/sites/default/files/2025-10/generic.pdf" title="Report on Bill No. 5 of 2025"></a>
      <a href="/sites/default/files/hansard.pdf">The Hansard</a>
      <a href="/files/untitled.pdf"> </a>
      <a href="/page">Not a PDF</a>
    </li></ul>"""
    rows = sync.parse_reports(html, committee)
    assert len(rows) == 2
    exact, generic = rows
    assert (exact["bill_house"], exact["bill_number"], exact["bill_year"], exact["date_tabled"]) == ("na", 12, 2026, date(2026, 2, 1))
    assert (generic["bill_house"], generic["bill_number"], generic["bill_year"]) == (None, 5, 2025)
    loose = sync.parse_reports('<a href="/x.pdf">Report without date</a>', committee)
    assert loose[0]["date_tabled"] is None


# ============ Documents and validation ============

def test_tracker_documents_are_replaced_but_others_kept():
    row = bill(stage_source_url="https://www.parliament.go.ke/bills-tracker.pdf", stage_as_at=date(2026, 3, 3))
    stored = json.dumps([{"name": "Legislative Proposals Tracker", "url": "old"}, {"name": "Bill PDF", "url": "bill.pdf"},
                         {"name": "Bill PDF again", "url": "bill.pdf"}, "junk"])
    merged = sync.merge_tracker_documents(stored, row)
    assert [d["url"] for d in merged] == [row.source_url, row.stage_source_url, "bill.pdf"]
    assert "as at 03 March 2026" in merged[1]["name"]
    assert sync.merge_tracker_documents("{not json", row)[0]["url"] == row.source_url
    assert sync.merge_tracker_documents(None, row)


def test_bills_with_missing_or_oversized_fields_are_skipped():
    assert sync.validate_bill(bill()) is None
    assert "missing required field 'title'" in sync.validate_bill(bill(title=""))
    assert "too long" in sync.validate_bill(bill(identifier="X" * 101))


# ============ Database: committees and documents ============

@pytest.mark.asyncio
async def test_committees_are_found_renamed_merged_or_created(db_session):
    async with test_engine.begin() as conn:
        assert await sync.ensure_committee_id(conn, "National Assembly Committee") is None
        assert await sync.ensure_committee_id(conn, None) is None
        created = await sync.ensure_committee_id(conn, "Departmental Committee on Health")
        assert await sync.ensure_committee_id(conn, "Departmental Committee on Health") == created

        # Two spellings of one committee collapse into one; bills and users follow it.
        await conn.execute(text("INSERT INTO committees (id,name,institution,status) VALUES (gen_random_uuid(),'Committee on Finance and National Planning','National Assembly','active'),(gen_random_uuid(),'Finance & National Planning','National Assembly','active')"))
        duplicate = (await conn.execute(text("SELECT id FROM committees WHERE name='Finance & National Planning'"))).scalar_one()
        await conn.execute(text("INSERT INTO legislative_items (id,title,identifier,institution,stage,documents,status_history,is_simulated,committee_id) VALUES (gen_random_uuid(),'B','NA/1','National Assembly','x','[]','[]',false,:c)"), {"c": duplicate})
        kept = await sync.ensure_committee_id(conn, "Finance and National Planning")
        names = (await conn.execute(text("SELECT name FROM committees WHERE name ILIKE '%finance%'"))).scalars().all()
        moved = (await conn.execute(text("SELECT committee_id FROM legislative_items WHERE identifier='NA/1'"))).scalar_one()
    assert names == ["Finance and National Planning"] and moved == kept


@pytest.mark.asyncio
async def test_bill_documents_are_added_once(db_session):
    async with test_engine.begin() as conn:
        await conn.execute(text("INSERT INTO legislative_items (id,title,identifier,institution,stage,documents,status_history,is_simulated) VALUES (gen_random_uuid(),'B','NA/2','National Assembly','x','[]','[]',false)"))
        bill_id = (await conn.execute(text("SELECT id FROM legislative_items WHERE identifier='NA/2'"))).scalar_one()
        await sync.merge_bill_document(conn, bill_id, "Bill", "")  # no URL: nothing to add
        await sync.merge_bill_document(conn, "00000000-0000-0000-0000-000000000000", "Bill", "u")  # unknown bill
        await sync.merge_bill_document(conn, bill_id, "Bill", "https://p/bill.pdf")
        await sync.merge_bill_document(conn, bill_id, "Bill", "https://p/bill.pdf")
        documents = (await conn.execute(text("SELECT documents FROM legislative_items WHERE id=:id"), {"id": bill_id})).scalar_one()
    assert documents == [{"name": "Bill", "url": "https://p/bill.pdf"}]


# ============ Database: bills ============

@pytest.mark.asyncio
async def test_bills_are_inserted_updated_and_administrator_committees_kept(db_session):
    async with test_engine.begin() as conn:
        rows = [bill(committee_name="Departmental Committee on Health", history=({"date": "2026-02-01", "stage": "First Reading", "note": "x"},)),
                bill(identifier="NA/2026/Bill-013", number=13), bill(identifier="", title="")]
        assert await sync.upsert_bills(conn, rows, date(2026, 3, 1)) == (2, 1)
        source = (await conn.execute(text("SELECT committee_assignment_source FROM legislative_items WHERE identifier='NA/2026/Bill-012'"))).scalar_one()
        assert source == "official record"

        await conn.execute(text("INSERT INTO committees (id,name,institution,status) VALUES (gen_random_uuid(),'Chosen','National Assembly','active')"))
        chosen = (await conn.execute(text("SELECT id FROM committees WHERE name='Chosen'"))).scalar_one()
        await conn.execute(text("UPDATE legislative_items SET committee_id=:c, committee_assignment_source='administrator' WHERE identifier='NA/2026/Bill-012'"), {"c": chosen})
        updated = bill(stage="Second Reading", committee_name="Departmental Committee on Health")
        assert await sync.upsert_bills(conn, [updated], date(2026, 3, 2)) == (0, 0)
        row = (await conn.execute(text("SELECT stage, committee_id, committee_assignment_source FROM legislative_items WHERE identifier='NA/2026/Bill-012'"))).first()
    assert row.stage == "Second Reading" and row.committee_id == chosen and row.committee_assignment_source == "administrator"


@pytest.mark.asyncio
async def test_a_database_error_skips_only_that_bill(db_session, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError

    async def broken(conn, row, as_at):
        raise SQLAlchemyError("constraint")
    monkeypatch.setattr(sync, "_upsert_bill", broken)
    async with test_engine.begin() as conn:
        assert await sync.upsert_bills(conn, [bill()], date(2026, 3, 1)) == (0, 1)


# ============ Database: notices ============

def notice(**fields):
    values = dict(title="Invitation to submit memoranda", source_url="https://www.parliament.go.ke/memoranda-water-bill",
                  notice_date=date(2026, 3, 1), deadline=date(2026, 3, 21), committee_name="Departmental Committee on Environment",
                  bill_title="Water Bill", bill_house="na", bill_number=12, bill_year=2026,
                  document_urls=("https://www.parliament.go.ke/water-bill.pdf",))
    values.update(fields)
    return NoticeRow(**values)


@pytest.mark.asyncio
async def test_notices_attach_to_bills_by_number_or_title(db_session):
    async with test_engine.begin() as conn:
        await prepare_schema(conn)
        await sync.upsert_bills(conn, [bill(), bill(identifier="NA/2026/Bill-020", title="The Forests Bill, 2026", number=20)], date(2026, 3, 1))
        page = "https://www.parliament.go.ke/memoranda-two-bills"
        done = await sync.upsert_notices(conn, [
            notice(source_url=page),
            notice(source_url=page, bill_title="Forests Bill", bill_number=None),  # by title
            notice(source_url="https://www.parliament.go.ke/memoranda-new", bill_title="Brand New Bill", bill_number=None, document_urls=()),
        ])
        assert done == 3
        new_bill = (await conn.execute(text("SELECT stage, committee_assignment_source FROM legislative_items WHERE identifier LIKE 'NA/2026/Notice-%'"))).first()
        assert new_bill.stage == "Public participation"
        water = (await conn.execute(text("SELECT documents, committee_assignment_source FROM legislative_items WHERE identifier='NA/2026/Bill-012'"))).first()
        assert any(d["url"].endswith("water-bill.pdf") for d in water.documents) and water.committee_assignment_source == "official record"

        # Re-reading the page now finds only the water bill: the forests row goes.
        await sync.upsert_notices(conn, [notice(source_url=page, deadline=date(2026, 3, 28))])
        rows = (await conn.execute(text("SELECT window_end FROM notice_records WHERE source_url=:u"), {"u": page})).scalars().all()
    assert rows == [date(2026, 3, 28)]


@pytest.mark.asyncio
async def test_a_bad_notice_does_not_stop_the_rest(db_session, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError
    real = sync._upsert_notice

    async def flaky(conn, row):
        if row.bill_title == "Broken Bill":
            raise SQLAlchemyError("bad row")
        return await real(conn, row)
    monkeypatch.setattr(sync, "_upsert_notice", flaky)
    async with test_engine.begin() as conn:
        await prepare_schema(conn)
        await sync.upsert_bills(conn, [bill()], date(2026, 3, 1))
        assert await sync.upsert_notices(conn, [notice(bill_title="Broken Bill"), notice()]) == 1


# ============ Database: reports ============

def report(**fields):
    values = dict(committee_name="Departmental Committee on Health", committee_url="https://www.parliament.go.ke/c/health",
                  institution="National Assembly", title="Report on the Water Bill (National Assembly Bills No. 12 of 2026)",
                  source_url="https://www.parliament.go.ke/r/water.pdf", date_tabled=date(2026, 3, 5),
                  bill_house="na", bill_number=12, bill_year=2026)
    values.update(fields)
    return values


@pytest.mark.asyncio
async def test_reports_link_by_reference_or_wait_for_a_person(db_session):
    async with test_engine.begin() as conn:
        await prepare_schema(conn)
        await sync.upsert_bills(conn, [bill(), bill(identifier="NA/2026/Bill-030", title="The Mental Health Bill, 2026", number=30)], date(2026, 3, 1))
        rows = [
            report(),
            report(source_url="https://www.parliament.go.ke/r/water-2.pdf"),  # same committee: consensus
            # A near name (not the exact one) waits for a person.
            report(title="Mental Helth Bill", source_url="https://www.parliament.go.ke/r/mental.pdf",
                   bill_house=None, bill_number=None, bill_year=2026, date_tabled=None),
            report(committee_name="Finance", source_url="https://www.parliament.go.ke/r/forests.pdf", bill_number=40),
            report(committee_name="Agriculture", committee_url="https://www.parliament.go.ke/c/agri", source_url="https://www.parliament.go.ke/r/forests-2.pdf", bill_number=40),
            report(committee_name="", bill_number=None, title="Untitled", source_url="https://www.parliament.go.ke/r/x.pdf"),
        ]
        assert await sync.upsert_reports(conn, rows) == 6
        linked = (await conn.execute(text("SELECT r.bill_ref IS NOT NULL FROM committee_reports r WHERE source_url LIKE '%/water.pdf'"))).scalar_one()
        water = (await conn.execute(text("SELECT c.name FROM legislative_items l JOIN committees c ON c.id=l.committee_id WHERE l.identifier='NA/2026/Bill-012'"))).scalar_one()
        reviews = (await conn.execute(text("SELECT match_method, confidence_score FROM legislative_link_reviews"))).fetchall()
        # Updating an existing report does not create a new one.
        assert await sync.upsert_reports(conn, [report(title="Corrected title")]) == 0
        title = (await conn.execute(text("SELECT title FROM committee_reports WHERE source_url LIKE '%/water.pdf'"))).scalar_one()
    assert linked and water == "Departmental Committee on Health"
    assert reviews and all(method == "title-review" and score >= 0.7 for method, score in reviews)
    assert title == "Corrected title"


@pytest.mark.asyncio
async def test_a_bad_report_does_not_stop_the_rest(db_session, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError

    async def broken(conn, row):
        raise SQLAlchemyError("bad")
    monkeypatch.setattr(sync, "_upsert_report", broken)
    async with test_engine.begin() as conn:
        assert await sync.upsert_reports(conn, [report()]) == 0


# ============ Full fetch and entry point ============

def committee_nav(count):
    links = "".join(f'<a href="/the-national-assembly/committees/c{i}">Committee on Topic{i}</a>' for i in range(count))
    return f'<div id="quicktabs-the_national_assembly_committees">{links}</div>'


def fetch_routes(committee_count=22):
    report_page = '<ul><li>Committee Reports <a href="/sites/default/files/2026-02/r.pdf">Report on Bill No. 5 of 2026</a></li></ul>'
    notice_html = ('<article>Submitted by admin on 1st March, 2026. The Departmental Committee on Health invites memoranda on '
                   'THE WATER BILL, 2026 (NATIONAL ASSEMBLY BILLS NO. 12 OF 2026) to be received on or before 21st March, 2026. '
                   '<a href="/sites/default/files/notice.pdf">Notice</a></article>')
    return {
        "/committees/c3": lambda r: httpx.Response(500, request=r),
        "/committees/c": report_page,
        "/the-national-assembly/committees": committee_nav(committee_count),
        "legislative-proposals-tracker": '<a href="/sites/default/files/2026-03/proposals-tracker.pdf">Tracker 1st March 2026</a>',
        "bill-tracker": '<a href="/sites/default/files/2026-03/bills-tracker.pdf">Bills Tracker 2nd March 2026</a>',
        "tracker.pdf": b"%PDF tracker",
        "notice.pdf": lambda r: httpx.Response(404, request=r),
        "memoranda-water-bill": notice_html,
    }


def patch_fetch(monkeypatch, routes, stage_rows=12):
    def factory(*args, **kwargs):
        return REAL_ASYNC_CLIENT(*args, transport=transport(routes), **kwargs)
    monkeypatch.setattr(sync.httpx, "AsyncClient", factory)
    monkeypatch.setattr(sync, "extract_pdf", lambda content, layout=True: "")
    monkeypatch.setattr(sync, "parse_tracker", lambda *a, **k: [bill()])
    monkeypatch.setattr(sync, "parse_bill_stage_tracker", lambda *a, **k: [bill(identifier=f"NA/2026/Bill-{n:03d}", number=n) for n in range(stage_rows)])

    async def notice_pages(client):
        return ["https://www.parliament.go.ke/memoranda-water-bill", "https://www.parliament.go.ke/memoranda-gone"]
    monkeypatch.setattr(sync, "discover_notice_pages", notice_pages)


@pytest.mark.asyncio
async def test_fetch_all_collects_bills_notices_and_reports(monkeypatch):
    patch_fetch(monkeypatch, fetch_routes())
    bills, notices, reports, committee_count, failed = await sync.fetch_all()
    assert committee_count == 22 and failed == 1
    assert len(reports) == 21 and bills
    assert [(n.bill_number, n.deadline) for n in notices] == [(12, date(2026, 3, 21))]


@pytest.mark.asyncio
async def test_fetch_all_refuses_partial_syncs(monkeypatch):
    patch_fetch(monkeypatch, fetch_routes(committee_count=5))
    with pytest.raises(RuntimeError, match="Only 5 committees"):
        await sync.fetch_all()
    patch_fetch(monkeypatch, fetch_routes(), stage_rows=3)
    with pytest.raises(RuntimeError, match="Only 3 explicit bill stages"):
        await sync.fetch_all()


@pytest.mark.asyncio
async def test_main_stores_everything_and_reports_failure_rates(db_session, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert await sync.main() == 1
    monkeypatch.setenv("DATABASE_URL", TEST_DB_URL)

    async def fetched(failed=0, rows=None):
        return rows if rows is not None else [bill()], [notice()], [report()], 20, failed
    import app.committee_assignment
    import app.scripts.sync_county_bills as county

    async def counties(conn):
        return {"Nairobi City County Assembly": (0, 0)}

    async def assign(conn):
        return {}
    monkeypatch.setattr(county, "sync_counties", counties)
    monkeypatch.setattr(app.committee_assignment, "assign_committees", assign)

    async def ok():
        return await fetched()
    async def no_texts():
        return []
    async def no_mzalendo(skip=frozenset()):
        return []
    monkeypatch.setattr(sync, "fetch_bill_texts", no_texts)
    monkeypatch.setattr(sync, "fetch_mzalendo_bill_texts", no_mzalendo)
    monkeypatch.setattr(sync, "fetch_all", ok)
    assert await sync.main() == 0
    async with TestSession() as session:
        assert (await session.execute(text("SELECT count(*) FROM notice_records"))).scalar_one() == 1

    async def many_failed():
        return await fetched(failed=10)
    monkeypatch.setattr(sync, "fetch_all", many_failed)
    assert await sync.main() == 1

    async def skipped():
        return await fetched(rows=[bill(identifier="", title="")])
    monkeypatch.setattr(sync, "fetch_all", skipped)
    assert await sync.main() == 1


@pytest.mark.asyncio
async def test_bills_are_at_public_participation_only_while_a_call_is_open(db_session):
    async with test_engine.begin() as conn:
        await prepare_schema(conn)
        await sync.upsert_bills(conn, [bill()], date(2026, 3, 1))
        await sync.upsert_notices(conn, [
            notice(),  # water bill: open 1-21 March
            notice(source_url="https://www.parliament.go.ke/memoranda-old", bill_title="Old Roads Bill", bill_number=None, deadline=date(2026, 3, 5), notice_date=date(2026, 2, 20)),
        ])
        stage = lambda ident: conn.execute(text("SELECT stage, status_history FROM legislative_items WHERE identifier LIKE :i"), {"i": ident})

        assert await sync.sync_participation_stages(conn, date(2026, 3, 10)) == (1, 1)
        water = (await stage("NA/2026/Bill-012")).first()
        assert water.stage == "Public participation" and "21 March 2026" in water.status_history[-1]["note"]
        assert (await stage("NA/2026/Notice-%")).first().stage == "Public participation closed"

        # The call closes: the bill goes back to its tracker stage.
        assert await sync.sync_participation_stages(conn, date(2026, 3, 25)) == (0, 1)
        assert (await stage("NA/2026/Bill-012")).first().stage == "First Reading"
        # Nothing to change on a second run.
        assert await sync.sync_participation_stages(conn, date(2026, 3, 25)) == (0, 0)


def test_prose_fragments_are_not_bill_names():
    for junk in ("Read the Bill", "M.P. The Bill"):
        assert sync.NOTICE_JUNK_TITLE_RE.search(junk), junk
    assert not sync.NOTICE_JUNK_TITLE_RE.search("Water Bill")


BILL_LIST_HTML = """
<table>
<tr><td><div class="post-title"><a href="/sites/default/files/2026-11/THE%20WATER%20BILL%2C2026.pdf">THE WATER BILL,2026</a></div></td></tr>
<tr><td><div class="post-title"><a href="/sites/default/files/2026-10/forests.pdf">The Forests Bill, 2026 (National Assembly Bills No. 20 of 2026)</a></div></td></tr>
<tr><td><div class="post-title"><a href="/sites/default/files/2026-10/climate.pdf">The Climate Change (Amendment) Bill, No.45 of 2026</a></div></td></tr>
<tr><td><div class="post-title"><a href="/sites/default/files/2026-09/digest.pdf">BILL DIGEST: THE WATER BILL, 2026</a></div></td></tr>
<tr><td><div class="post-title"><a href="/sites/default/files/2026-11/hansard.pdf">The Hansard - Thursday</a></div></td></tr>
</table>
"""


def test_bill_list_keeps_bill_pdfs_only():
    rows = sync.parse_bill_list(BILL_LIST_HTML, "https://www.parliament.go.ke/the-national-assembly/house-business/bills")
    assert [(r.title, r.house, r.number, r.year) for r in rows] == [
        ("THE WATER BILL,2026", None, None, 2026),
        ("The Forests Bill, 2026 (National Assembly Bills No. 20 of 2026)", "na", 20, 2026),
        ("The Climate Change (Amendment) Bill, No.45 of 2026", None, None, 2026),
    ]
    assert rows[0].url.startswith("https://www.parliament.go.ke/sites/default/files/")


@pytest.mark.asyncio
async def test_bill_texts_attach_by_number_or_title(db_session):
    async with test_engine.begin() as conn:
        await prepare_schema(conn)
        await sync.upsert_bills(conn, [bill(), bill(identifier="NA/2026/Bill-020", title="The Forests Bill, 2026", number=20),
                                       bill(identifier="NA/2026/Bill-030", title="The Climate Change (Amendment) Bill, 2026", number=30)], date(2026, 3, 1))
        rows = sync.parse_bill_list(BILL_LIST_HTML, "https://www.parliament.go.ke/the-national-assembly/house-business/bills")
        assert await sync.attach_bill_texts(conn, rows) == 3
        assert await sync.attach_bill_texts(conn, rows) == 0  # already linked
        docs = dict((await conn.execute(text("SELECT identifier, documents FROM legislative_items WHERE identifier IN ('NA/2026/Bill-012','NA/2026/Bill-020')"))).all())
        assert any(d["url"].endswith("THE%20WATER%20BILL%2C2026.pdf") for d in docs["NA/2026/Bill-012"])
        assert any(d["url"].endswith("forests.pdf") for d in docs["NA/2026/Bill-020"])


# ============ Linking reports by name, and bill texts from Mzalendo ============

def test_a_report_title_names_its_bill_only_from_a_lead_word():
    words, year = sync.report_bill_reference("Report of the Budget Committee on the Equalization Fund Appropriation Bill, 2025.pdf")
    assert year == 2025
    assert sync.name_matches(words, sync._bill_name_words("The Equalisation Fund Appropriation Bill, 2025"))
    assert not sync.name_matches(words, sync._bill_name_words("The Appropriation Bill, 2025"))
    words, _ = sync.report_bill_reference("Report on the consideration of the Food and Feed Safety Control Co-ordination Bill, 2023")
    assert sync.name_matches(words, sync._bill_name_words("The Food and Feed Safety Control Coordination Bill, 2023"))
    words, _ = sync.report_bill_reference("Report of the Budget Committee on the Division of Revenue Bill, 2026")
    assert not sync.name_matches(words, sync._bill_name_words("The Revenue Bill, 2026"))
    assert sync.report_bill_reference("The Creative Economy Support Bill (Senate No. 30 of 2024).pdf")[1] == 2024
    assert sync.report_bill_reference("No bill here")[0] == [] and sync.report_bill_reference("Annual report") == ([], None)


@pytest.mark.asyncio
async def test_reports_link_by_exact_name_or_short_reference(db_session):
    async with test_engine.begin() as conn:
        await prepare_schema(conn)
        await sync.upsert_bills(conn, [
            bill(),
            bill(identifier="NA/2025/Bill-021", title="The Equalisation Fund Appropriation Bill, 2025", number=21, year=2025),
            bill(identifier="NA/2025/Bill-023", title="The Appropriation Bill, 2025", number=23, year=2025),
            bill(identifier="SENATE/2024/Bill-030", title="The Creative Economy Support Bill, 2024", house="senate", number=30, year=2024),
            bill(identifier="NA/2024/Bill-030", title="The Kenya Roads Bill, 2024", number=30, year=2024),
            bill(identifier="NA/2023/Bill-036", title="The Transport Authority (Amendment) Bill, 2023", number=36, year=2023),
            bill(identifier="NA/2024/Bill-024", title="The Transport Authority (Amendment) Bill, 2024", number=24, year=2024),
        ], date(2026, 3, 1))
        none = dict(bill_house=None, bill_number=None, bill_year=None)
        rows = [
            report(title="Report on the Equalization Fund Appropriation Bill, 2025.pdf", source_url="https://www.parliament.go.ke/r/1.pdf", **none),
            report(title="The Report on the Creative Economy Support Bill (Senate No. 30 of 2024).pdf", source_url="https://www.parliament.go.ke/r/2.pdf", **none),
            # No year and two bills of that name: left for a person.
            report(title="Report on Consideration of the Transport Authority (Amendment) Bill-1.pdf", source_url="https://www.parliament.go.ke/r/3.pdf",
                   date_tabled=date(2024, 6, 1), **none),
        ]
        await sync.upsert_reports(conn, rows)
        linked = dict((await conn.execute(text(
            "SELECT r.source_url, l.identifier FROM committee_reports r LEFT JOIN legislative_items l ON l.id=r.bill_ref"))).all())
        # A report linked later keeps its link when the sync sees it again without one.
        await conn.execute(text("UPDATE committee_reports SET bill_ref=(SELECT id FROM legislative_items WHERE identifier='NA/2023/Bill-036') WHERE source_url LIKE '%/3.pdf'"))
        await sync.upsert_reports(conn, rows[2:])
        kept = (await conn.execute(text("SELECT bill_ref IS NOT NULL FROM committee_reports WHERE source_url LIKE '%/3.pdf'"))).scalar_one()
        await conn.execute(text("UPDATE committee_reports SET bill_ref=NULL"))
        relinked = await sync.link_unlinked_reports(conn)
    assert linked["https://www.parliament.go.ke/r/1.pdf"] == "NA/2025/Bill-021"
    assert linked["https://www.parliament.go.ke/r/2.pdf"] == "SENATE/2024/Bill-030"
    assert linked["https://www.parliament.go.ke/r/3.pdf"] is None
    assert kept and relinked == 2


MZALENDO_PAGE = """<html><head><script type="application/ld+json">{"@graph": [{"@type": "Legislation",
"legislationIdentifier": "National Assembly Bill No. 66 of 2026",
"isBasedOn": "https://www.parliament.go.ke/sites/default/files/2026-10/ANTI-DOPING.pdf"}]}</script>
<script type="application/ld+json">not json</script></head><body></body></html>"""
MZALENDO_COPY_PAGE = """<html><body><a href="https://fra1.digitaloceanspaces.com/mzdocs/prod/media/bills/pdfs/na-2026-442.pdf">PDF</a></body></html>"""


def test_mzalendo_bill_pages_give_the_reference_and_pdf():
    found = sync.parse_mzalendo_bill_page(MZALENDO_PAGE, "The Anti-Doping (Amendment) Bill, 2026", 2026)
    assert (found.house, found.number, found.year, found.name) == ("na", 66, 2026, sync.BILL_TEXT_NAME)
    copy = sync.parse_mzalendo_bill_page(MZALENDO_COPY_PAGE, "The Architects Bill, 2026", 2026)
    assert copy.name == sync.MZALENDO_COPY_NAME and copy.number is None and copy.year == 2026
    assert sync.parse_mzalendo_bill_page("<html></html>", "x", 2026) is None


@pytest.mark.asyncio
async def test_mzalendo_bill_texts_are_fetched_and_attached(db_session, monkeypatch):
    csv_text = ("ID,Bill,Year,Stage,Sponsor,House,Updated,URL\n"
                "853,\"The Anti-Doping (Amendment) Bill, 2026\",2026,First Reading,,National Assembly,2026-10-15,https://mzalendo.com/legislative-trends/bills/na/853/\n"
                "442,\"The Architects Bill, 2026\",2026,First Reading,,National Assembly,2026-07-03,https://mzalendo.com/legislative-trends/bills/na/442/\n"
                "1,\"The Water Bill, 2026\",2026,First Reading,,National Assembly,2026-07-03,https://mzalendo.com/legislative-trends/bills/na/1/\n"
                "9,\"Missing page Bill\",2026,First Reading,,Senate,2026-07-03,https://mzalendo.com/legislative-trends/bills/senate/9/\n")
    routes = {"format=csv": csv_text, "/na/853/": MZALENDO_PAGE, "/na/442/": MZALENDO_COPY_PAGE,
              "/senate/9/": lambda request: httpx.Response(503, request=request)}
    monkeypatch.setattr(sync.httpx, "AsyncClient", lambda **kw: REAL_ASYNC_CLIENT(transport=transport(routes), **kw))
    texts = await sync.fetch_mzalendo_bill_texts({(sync.canonical_title("The Water Bill, 2026"), 2026)})
    assert [(t.number, t.house) for t in texts] == [(66, "na"), (None, "na")]
    async with test_engine.begin() as conn:
        await prepare_schema(conn)
        await sync.upsert_bills(conn, [bill(identifier="NA/2026/Bill-066", title="The Anti-Doping (Amendment) Bill, 2026", number=66),
                                       bill(identifier="NA/2026/Bill-044", title="The Architects Bill, 2026", number=44)], date(2026, 3, 1))
        assert await sync.attach_bill_texts(conn, texts) == 2
        assert await sync.titles_with_text(conn) == {(sync.canonical_title("The Anti-Doping (Amendment) Bill, 2026"), 2026),
                                                    (sync.canonical_title("The Architects Bill, 2026"), 2026)}
