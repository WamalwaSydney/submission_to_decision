"""Command-line scripts (analyse_reports, trace_house, trace_acts, fill_gaps, download_county_acts, seed)
and the House trace's Hansard reading, with Gemini and every website faked so nothing goes online."""
import argparse
import json
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from app.models import ActTrace, HouseTrace, ReportAnalysis, User
from app.services import act_trace_service, evidence, house_trace_service, llm_matching_service, report_analysis_service
from tests.test_api import TEST_DB_URL, TestSession, db_session, test_engine  # noqa: F401  (pytest fixtures)
from tests.test_routes_workflow import add, bill_row, isolated_storage, report_for  # noqa: F401

PAGE_WITH_DEBATE = """<div>IN THE COMMITTEE</div><div>[The Temporary Chairman (Hon. Farah Maalim) in the Chair]</div>
<div>VIRTUAL ASSET SERVICE PROVIDERS BILL</div>
<div>(National Assembly Bill No. 15 of 2025) We are in Committee.</div>
<div>(Clause 5 as amended agreed to)</div>
<div>IN THE HOUSE</div><div>Other business</div>"""
LISTING = ('<a href="/democracy-tools/hansard/document/1585/">Thursday, 2nd October, 2025 - Afternoon Sitting National Assembly</a>'
           '<a href="/democracy-tools/hansard/document/1586/">Thursday, 2nd October, 2025 - Evening Sitting National Assembly</a>')


def ns(**fields):
    return argparse.Namespace(**fields)


def patch_http(monkeypatch, module, handler):
    """Make every httpx.AsyncClient the module creates answer from `handler`."""
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real(*args, transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(module.httpx, "AsyncClient", factory)


async def analysed_bill(db_session, title, identifier, stage="Assented", decisions=("adopted", "adopted")):
    bill = await add(db_session, bill_row(stage=stage, title=title, identifier=identifier, bill_year=2025, bill_house="na", bill_number=15))
    report, entries = await report_for(db_session, bill, [(f"Clause {i + 5}", f"Proposal {i}", "unclassified", None) for i in range(len(decisions))])
    items = [{"entry_id": str(e.id), "clause_ref": e.clause_ref, "stakeholder": "Org", "issue": e.extracted_summary, "decision": d, "reason": "Agreed"}
             for e, d in zip(entries, decisions)]
    await add(db_session, ReportAnalysis(report_ref=report.id, model="m", entries_analysed=len(items), items=items))
    return bill, report, entries


# ---------------------------------------------------------------- House trace: Hansard and Gemini

@pytest.mark.asyncio
async def test_house_trace_asks_gemini_retries_and_checks_every_decision(monkeypatch):
    from tests.test_act_trace import HANSARD
    items = [
        {"report_id": "r", "entry_id": "e5", "clause_ref": "Clause 5", "issue": "Delete the words", "decision": "adopted", "reason": "ok"},
        {"report_id": "r", "entry_id": "e40", "clause_ref": "Clause 40", "issue": "Delete subclause (2)", "decision": "amended", "reason": "ok"},
        {"report_id": "r", "entry_id": "e31", "clause_ref": "Clause 31", "issue": "We support the clause as drafted", "decision": "adopted", "reason": "ok"},
        {"report_id": "r", "entry_id": "e9", "clause_ref": "Clause 9", "issue": "Something else", "decision": "adopted", "reason": "ok"},
        {"report_id": "r2", "entry_id": "e5b", "clause_ref": "Clause 5", "issue": "Delete the words", "decision": "adopted", "reason": "ok"},
        {"report_id": "r", "entry_id": "rej", "clause_ref": "Clause 2", "issue": "Rejected", "decision": "rejected", "reason": "no"},
    ]
    prompts = []

    async def generate_json(system, prompt, schema, max_output_tokens=3000):
        prompts.append(prompt)
        if "note_on_previous_answer" not in prompt:  # first answers: Clause 40 missing, Clause 9 points at Clause 5's lines
            return {"results": [{"id": "0", "decision": "agreed", "lines": "H4-H7", "clause": "Clause 5", "explanation": "Agreed."},
                                {"id": "2", "decision": "unchanged", "lines": "H8", "explanation": "Passed unchanged."},
                                {"id": "3", "decision": "agreed", "lines": "H4-H7", "explanation": "Wrong clause."},
                                {"id": "0", "decision": "negatived", "lines": "H9-H11"}]}  # a second answer for one id is ignored
        return {"results": [{"id": "1", "decision": "negatived", "lines": "H9-H11", "explanation": "Negatived."},
                            {"id": "3", "decision": "agreed", "lines": "H4-H7"}]}

    async def verify(claims):
        return {"0": {"verdict": "yes", "reason": "Carries it out."}, "1": {"verdict": "no", "reason": "Different subclause."}}
    monkeypatch.setattr(llm_matching_service, "generate_json", generate_json)
    monkeypatch.setattr(evidence, "verify", verify)
    sittings = [{"id": 1, "url": "https://mzalendo.com/democracy-tools/hansard/document/1/", "title": "Thursday"}]
    results = {r["key"]: r for r in await house_trace_service.trace(items, HANSARD, sittings, "VASP Bill")}
    assert results["r:e5"]["decision"] == "agreed" and results["r:e5"]["verdict"] == "yes" and results["r:e5"]["sitting"]["id"] == 1
    assert results["r2:e5b"]["decision"] == "agreed"  # the same recommendation in a second report shares the answer
    assert results["r:e40"]["decision"] == "unclear" and "does not carry out" in results["r:e40"]["explanation"]
    assert results["r:e31"]["decision"] == "unchanged" and results["r:e31"]["supported"] is True
    assert results["r:e9"]["decision"] == "unclear"
    assert "r:rej" not in results and len(prompts) == 2
    assert house_trace_service.counts(list(results.values()))["agreed"] == 2


@pytest.mark.asyncio
async def test_house_trace_reads_hansard_sittings_from_mzalendo():
    asked = []

    def handler(request):
        asked.append(str(request.url))
        if request.url.path == "/democracy-tools/hansard/":
            if request.url.params["from"].startswith("2025-10-17"):
                return httpx.Response(500)
            return httpx.Response(200, text=LISTING)
        if request.url.path.endswith("/1585/"):
            return httpx.Response(200, text=PAGE_WITH_DEBATE)
        return httpx.Response(404)

    bill = SimpleNamespace(status_history=[{"stage": "Committee of the Whole House", "date": "2025-10-02"},
                                           {"stage": "Committee of the Whole House", "date": "2025-10-20"}],
                           bill_house="na", bill_number=15, bill_year=2025, title="The Virtual Asset Service Providers Bill, 2025")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        sittings, text = await house_trace_service.find_sittings(bill, client)
        assert [s["id"] for s in sittings] == [1585]
        assert text.startswith("=== SITTING: Thursday, 2nd October, 2025 - Afternoon Sitting National Assembly") and "Clause 5 as amended" in text
        no_dates = SimpleNamespace(status_history=[{"stage": "First Reading", "date": "2025-01-01"}], bill_house="na", bill_number=1, bill_year=2025, title="X")
        assert await house_trace_service.find_sittings(no_dates, client) == ([], "")


@pytest.mark.asyncio
async def test_house_trace_run_reads_the_hansard_once_and_stores_the_result(db_session, monkeypatch):
    from tests.test_act_trace import HANSARD
    bill, _, _ = await analysed_bill(db_session, "The Virtual Asset Service Providers Bill, 2025", "NA/2025/Bill-015")
    fetched = []

    async def find_sittings(b, client):
        fetched.append(b.id)
        return [{"id": 1, "url": "u", "title": "t"}], HANSARD

    async def trace(items, text, sittings, title):
        return [{"key": "k", "decision": "agreed"}]
    monkeypatch.setattr(house_trace_service, "find_sittings", find_sittings)
    monkeypatch.setattr(house_trace_service, "trace", trace)
    async with TestSession() as session:
        row = await house_trace_service.run(session, bill, [], client=None)
        await session.commit()
        assert row.items == [{"key": "k", "decision": "agreed"}] and row.checked_at is not None
        await house_trace_service.run(session, bill, [], client=None)  # stored Hansard is reused
        assert len(fetched) == 1
        await house_trace_service.run(session, bill, [], client=None, refetch=True)
        assert len(fetched) == 2
        public = house_trace_service.to_public(row)
        assert public["found"] is True and public["counts"]["agreed"] == 1
    assert house_trace_service.to_public(None) is None

    async def nothing(b, client):
        return [], ""
    monkeypatch.setattr(house_trace_service, "find_sittings", nothing)
    other, _, _ = await analysed_bill(db_session, "The Other Bill, 2025", "NA/2025/Bill-099")
    async with TestSession() as session:
        row = await house_trace_service.run(session, other, [], client=None)
        assert row.checked_at is None and row.items == []


# ---------------------------------------------------------------- analyse_reports and trace_house scripts

@pytest.mark.asyncio
async def test_analyse_reports_script(db_session, monkeypatch, capsys):
    from app.scripts import analyse_reports
    a = lambda **kw: ns(**{"bill": None, "passed": False, "all": False, "limit": 0, "redo": False, "names": False, **kw})
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: False)
    with pytest.raises(SystemExit):
        await analyse_reports.run(a(passed=True))
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: True)
    monkeypatch.setattr(analyse_reports, "async_session", TestSession)
    with pytest.raises(SystemExit):
        await analyse_reports.run(a())

    good = await add(db_session, bill_row(stage="Assented", title="The Good Bill, 2025", identifier="NA/2025/Bill-001"))
    broken = await add(db_session, bill_row(stage="Assented", title="The Broken Bill, 2025", identifier="NA/2025/Bill-002"))
    empty = await add(db_session, bill_row(stage="Assented", title="The Empty Bill, 2025", identifier="NA/2025/Bill-003"))
    await report_for(db_session, good, [("Clause 1", "A view", "adopted", None)])
    await report_for(db_session, broken, [("Clause 1", "A view", "adopted", None)])
    await report_for(db_session, empty)  # no entries: nothing to analyse

    async def analyse_report(db, report, title):
        if "Broken" in title:
            raise RuntimeError("Gemini request failed (503)")
        analysis = ReportAnalysis(report_ref=report.id, model="m", entries_analysed=1, items=[{"decision": "adopted"}])
        db.add(analysis)
        await db.flush()
        return analysis
    monkeypatch.setattr(report_analysis_service, "analyse_report", analyse_report)
    await analyse_reports.run(a(passed=True))
    out = capsys.readouterr().out
    assert "2 report(s) to analyse" in out and "NA/2025/Bill-001: 1 submissions in 1 entries" in out and "FAILED NA/2025/Bill-002" in out
    await analyse_reports.run(a(all=True, limit=5))  # the analysed report is skipped
    assert "1 report(s) to analyse" in capsys.readouterr().out
    await analyse_reports.run(a(bill=["NA/2025/Bill-001"], redo=True))
    assert "1 report(s) to analyse" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_analyse_reports_finds_unnamed_stakeholders(db_session, monkeypatch, capsys):
    from app.scripts import analyse_reports
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: True)
    monkeypatch.setattr(analyse_reports, "async_session", TestSession)
    bill = await add(db_session, bill_row(title="The Named Bill, 2025"))
    first, _ = await report_for(db_session, bill, [("Clause 1", "A view", "adopted", None)], title="First report")
    second, _ = await report_for(db_session, bill, [("Clause 1", "A view", "adopted", None)], title="Second report")
    named, _ = await report_for(db_session, bill, title="Named report")
    unnamed = [{"entry_id": "x", "stakeholder": report_analysis_service.UNNAMED, "decision": "adopted"}]
    await add(db_session, ReportAnalysis(report_ref=first.id, model="m", entries_analysed=1, items=unnamed),
              ReportAnalysis(report_ref=second.id, model="m", entries_analysed=1, items=unnamed),
              ReportAnalysis(report_ref=named.id, model="m", entries_analysed=0, items=[{"stakeholder": "Org"}]))
    calls = []

    async def recover_names(text, items, entries):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("Gemini failed")
        items[0]["stakeholder"] = "Found Org"
        return 1

    async def submitters(text):
        return ["Found Org"]
    monkeypatch.setattr(report_analysis_service, "recover_names", recover_names)
    monkeypatch.setattr(report_analysis_service, "list_submitters", submitters)
    await analyse_reports.run(ns(bill=None, passed=False, all=False, limit=0, redo=False, names=True))
    out = capsys.readouterr().out
    assert "2 report(s) with unnamed stakeholders" in out and "named 1 of 1" in out and "FAILED" in out
    async with TestSession() as session:
        analyses = (await session.execute(select(ReportAnalysis))).scalars().all()
    found = [a for a in analyses if any(i.get("stakeholder") == "Found Org" for i in a.items)]
    assert len(found) == 1 and found[0].submitters == ["Found Org"]


@pytest.mark.asyncio
async def test_trace_house_script(db_session, monkeypatch, capsys):
    from app.scripts import trace_house
    a = lambda **kw: ns(**{"bill": None, "passed": False, "refetch": False, "redo": False, **kw})
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: False)
    with pytest.raises(SystemExit):
        await trace_house.run(a(passed=True))
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: True)
    monkeypatch.setattr(trace_house, "async_session", TestSession)
    with pytest.raises(SystemExit):
        await trace_house.run(a())
    await analysed_bill(db_session, "The Licensing Bill, 2025", "NA/2025/Bill-015")
    await analysed_bill(db_session, "The Quiet Bill, 2025", "NA/2025/Bill-016")
    await analysed_bill(db_session, "The Broken Bill, 2025", "NA/2025/Bill-017")
    await analysed_bill(db_session, "The Rejected Bill, 2025", "NA/2025/Bill-018", decisions=("rejected",))  # nothing adopted to trace

    async def run(db, bill, items, client, refetch=False):
        if bill.title.startswith("The Broken"):
            raise RuntimeError("Gemini down")
        found = bill.title.startswith("The Licensing")
        row = HouseTrace(bill_ref=bill.id, sittings=[{"id": 1}] if found else [], items=[{"key": "k", "decision": "agreed"}] if found else [])
        db.add(row)
        await db.flush()
        return row
    monkeypatch.setattr(house_trace_service, "run", run)
    await trace_house.run(a(passed=True))
    out = capsys.readouterr().out
    assert "3 bill(s) to trace" in out and "1 sitting(s); of 1 adopted recommendations, 1 agreed" in out
    assert "The Quiet Bill, 2025: no Committee of the Whole House sitting found" in out and "FAILED The Broken Bill, 2025" in out
    await trace_house.run(a(bill=["NA/2025/Bill-017"], redo=True))
    assert "1 bill(s) to trace" in capsys.readouterr().out


# ---------------------------------------------------------------- trace_acts script

LAW_LISTING = """<td class="cell-title"><a href="/akn/ke/act/2025/20/eng@2025-11-04" data-key-link="document">Virtual Asset Service Providers Act</a></td>"""
ACTS_PAGE = """<a href="https://www.parliament.go.ke/sites/default/files/2025-11/Gaming.pdf" class="x" title="The Gaming Act, 2025.pdf">Gaming</a>
<a href="https://www.parliament.go.ke/sites/default/files/2025-11/Roads.pdf" title="The Roads Act, 2025">Roads</a>
<a href="https://www.parliament.go.ke/sites/default/files/2025-11/Nothing.pdf" title="The Unknown Act, 2025">Unknown</a>
<a href="https://www.parliament.go.ke/sites/default/files/2025-11/Ports.pdf" title="The Ports Act, 2025">Ports</a>"""
ACT_TEXT = "THE GAMING ACT No. 7 of 2025. " + "Every operator shall hold a licence. " * 30


@pytest.mark.asyncio
async def test_trace_acts_finds_lists_and_fetches_acts(db_session, monkeypatch, capsys):
    from app.scripts import trace_acts
    vasp = await add(db_session, bill_row(stage="Assented", title="The Virtual Asset Service Providers Bill, 2025", bill_year=2025))
    await add(db_session, bill_row(stage="Assented", title="The Unlisted Bill, 2025", bill_year=2025))

    def kenya_law(request):
        if request.url.params.get("years") == "2026":
            return httpx.Response(503)
        return httpx.Response(200, text=LAW_LISTING)
    patch_http(monkeypatch, trace_acts, kenya_law)
    async with TestSession() as session:
        await trace_acts.find(session)
        await trace_acts.list_links(session)
    out = capsys.readouterr().out
    assert "Linked 1 bills to their Act" in out and "HTTP 503" in out and "Act No. 20 of 2025" in out

    monkeypatch.delenv("LAWS_AFRICA_TOKEN", raising=False)
    async with TestSession() as session:
        with pytest.raises(SystemExit):
            await trace_acts.fetch(session)
    monkeypatch.setenv("LAWS_AFRICA_TOKEN", "secret")
    empty = await add(db_session, bill_row(stage="Assented", title="The Empty Bill, 2025"))
    broken = await add(db_session, bill_row(stage="Assented", title="The Broken Bill, 2025"))
    await add(db_session, ActTrace(bill_ref=empty.id, act_title="Empty Act", act_url="https://kenyalaw.org/akn/ke/act/2025/1", items=[]),
              ActTrace(bill_ref=broken.id, act_title="Broken Act", act_url="https://kenyalaw.org/akn/ke/act/2025/2", items=[]))

    async def fetch_act_text(url, client):
        if url.endswith("/1"):
            return None
        if url.endswith("/2"):
            raise RuntimeError("HTTP 401")
        return ACT_TEXT
    monkeypatch.setattr(act_trace_service, "fetch_act_text", fetch_act_text)
    async with TestSession() as session:
        fetched = await trace_acts.fetch(session)
    out = capsys.readouterr().out
    assert fetched == [vasp.id] and "Empty Act: no text returned" in out and "FAILED Broken Act" in out


@pytest.mark.asyncio
async def test_trace_acts_loads_acts_from_parliament(db_session, isolated_storage, monkeypatch, capsys):
    from app.scripts import trace_acts
    gaming = await add(db_session, bill_row(stage="Assented", title="The Gaming Bill, 2025", bill_year=2025))
    roads = await add(db_session, bill_row(stage="Assented", title="The Roads Bill, 2025", bill_year=2025))
    await add(db_session, bill_row(stage="Assented", title="The Ports Bill, 2025", bill_year=2025))
    await add(db_session, ActTrace(bill_ref=roads.id, act_title="The Roads Act, 2025", act_text=ACT_TEXT, items=[]))

    def parliament(request):
        if "house-business/acts" in str(request.url):
            return httpx.Response(200, text=ACTS_PAGE)
        if request.url.path.endswith("Gaming.pdf"):
            return httpx.Response(200, content=b"%PDF-1.4 gaming")
        return httpx.Response(404)
    patch_http(monkeypatch, trace_acts, parliament)
    monkeypatch.setattr(trace_acts, "pdf_text", lambda path: ACT_TEXT)
    async with TestSession() as session:
        loaded = await trace_acts.from_parliament(session)
    out = capsys.readouterr().out
    assert loaded == [gaming.id]
    assert "The Roads Act, 2025: already loaded" in out and "The Unknown Act, 2025: no matching assented bill" in out
    assert "The Ports Act, 2025: download failed (HTTP 404)" in out
    async with TestSession() as session:
        row = (await session.execute(select(ActTrace).where(ActTrace.bill_ref == gaming.id))).scalar_one()
    assert row.act_text == ACT_TEXT and row.act_title == "The Gaming Act, 2025"


@pytest.mark.asyncio
async def test_trace_acts_loads_folders_and_files_then_checks(db_session, isolated_storage, tmp_path, monkeypatch, capsys):
    from app.scripts import trace_acts
    a = lambda **kw: ns(**{"find": False, "list": False, "fetch": False, "parliament": False, "dir": None, "file": None, "bill": None, "check": False, **kw})
    bill, _, _ = await analysed_bill(db_session, "The Gaming Bill, 2025", "NA/2025/Bill-007")
    plain = await add(db_session, bill_row(stage="Assented", title="The Plain Bill, 2025", identifier="NA/2025/Bill-008"))
    pending = await add(db_session, bill_row(stage="Second Reading", title="The Pending Bill, 2025", identifier="NA/2025/Bill-009"))
    await add(db_session, ActTrace(bill_ref=bill.id, act_title="The Gaming Act, 2025", act_citation="Act No. 7 of 2025", items=[]),
              ActTrace(bill_ref=plain.id, act_title="The Plain Act, 2025", items=[]))
    folder = tmp_path / "acts"
    folder.mkdir()
    (folder / "gaming.pdf").write_bytes(b"%PDF-1.4 a")
    (folder / "stranger.pdf").write_bytes(b"%PDF-1.4 b")
    texts = {"gaming.pdf": ACT_TEXT, "stranger.pdf": "Some other law. " * 40}
    monkeypatch.setattr(trace_acts, "pdf_text", lambda path: texts.get(path.name, ACT_TEXT))

    async def run_trace(db, row, items, title, bill_text):
        if title.startswith("The Plain"):
            raise RuntimeError("Gemini down")
        row.items = [{"key": "k", "status": "in_act"}]
        return row

    async def no_bill_text(documents):
        return None
    monkeypatch.setattr(act_trace_service, "run_trace", run_trace)
    monkeypatch.setattr(act_trace_service, "fetch_bill_text", no_bill_text)
    monkeypatch.setattr(trace_acts, "async_session", TestSession)
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: False)
    with pytest.raises(SystemExit):
        await trace_acts.run(a(dir=str(folder)))
    with pytest.raises(SystemExit):
        await trace_acts.run(a(check=True))
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: True)

    await trace_acts.run(a(dir=str(folder)))
    out = capsys.readouterr().out
    assert "gaming.pdf: → The Gaming Bill, 2025" in out and "stranger.pdf: no matching bill" in out
    assert "The Gaming Bill, 2025: 1 of 1 adopted recommendations are in the final Act" in out and "(bill as published not available)" in out

    with pytest.raises(SystemExit):
        await trace_acts.run(a(bill=["NA/2025/Bill-007"], file=[str(folder / "gaming.pdf")] * 2))  # two files, one bill
    with pytest.raises(SystemExit):
        await trace_acts.run(a(bill=["NA/1999/Bill-0"], file=[str(folder / "gaming.pdf")]))
    await trace_acts.run(a(bill=["NA/2025/Bill-009", "NA/2025/Bill-008"], file=[str(folder / "gaming.pdf")] * 2))
    out = capsys.readouterr().out
    assert "skip NA/2025/Bill-009: not assented" in out and "The Plain Bill, 2025: no adopted recommendations" in out

    await trace_acts.run(a(check=True, bill=["NA/2025/Bill-007"]))
    assert "1 of 1 adopted recommendations" in capsys.readouterr().out
    plain_report, plain_entries = await report_for(db_session, plain, [("Clause 1", "A view", "adopted", None)])
    await add(db_session, ReportAnalysis(report_ref=plain_report.id, model="m", entries_analysed=1,
                                         items=[{"entry_id": str(plain_entries[0].id), "decision": "adopted", "clause_ref": "Clause 1"}]))
    await trace_acts.run(a(check=True))
    assert f"FAILED {plain.id}: Gemini down" in capsys.readouterr().out

    def kenya_law(request):
        return httpx.Response(200, text="")
    patch_http(monkeypatch, trace_acts, kenya_law)
    await trace_acts.run(a(find=True, list=True))
    assert "Linked 0 bills" in capsys.readouterr().out


# ---------------------------------------------------------------- fill_gaps, download_county_acts, seed

@pytest.mark.asyncio
async def test_fill_gaps_links_reports_adds_texts_and_reads_reports(db_session, monkeypatch, capsys):
    from app.scripts import fill_gaps, sync_legislation as sync
    monkeypatch.setenv("DATABASE_URL", TEST_DB_URL)

    async def no_texts(skip):
        return []
    monkeypatch.setattr(sync, "fetch_mzalendo_bill_texts", no_texts)
    monkeypatch.setattr(fill_gaps, "async_session", TestSession)
    good = await add(db_session, bill_row(title="The Good Bill, 2025"))
    bad = await add(db_session, bill_row(title="The Bad Bill, 2025"))
    await report_for(db_session, good, extraction_status="pending")
    await report_for(db_session, bad, extraction_status="pending")

    async def extract(db, bill_ref=None):
        if bill_ref == bad.id:
            raise RuntimeError("PDF too large")
        return 1
    monkeypatch.setattr(fill_gaps.ingestion_service, "extract_pending_linked_reports", extract)
    await fill_gaps.run(ns(part=None, no_extract=False))
    out = capsys.readouterr().out
    assert "Reports linked to their bill: 0" in out and "Bill texts from Mzalendo: 0 found" in out
    assert "Reading reports for 2 bill(s)" in out and "read 1 report(s)" in out and "FAILED: PDF too large" in out
    await fill_gaps.run(ns(part="1/2", no_extract=False))
    assert "Reading reports for 1 bill(s)" in capsys.readouterr().out
    await fill_gaps.run(ns(part=None, no_extract=True))
    assert "Reading reports" not in capsys.readouterr().out


COUNTY_ACTS_PAGE = """<table>
<tr><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/Energy.pdf">The Nairobi City County Energy Act 2026</a></td><td>2nd September, 2026</td></tr>
<tr><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/Energy-copy.pdf">The Nairobi City County Energy Act 2026</a></td><td>2nd September, 2026</td></tr>
<tr><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/Flaky.pdf">The Nairobi City County Flaky Act 2026</a></td><td>1st July, 2026</td></tr>
<tr><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/Page.pdf">The Nairobi City County Page Act 2026</a></td><td>1st July, 2026</td></tr>
<tr><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/Gone.pdf">The Nairobi City County Gone Act 2026</a></td><td>1st July, 2026</td></tr>
</table>"""


@pytest.mark.asyncio
async def test_county_act_pdfs_are_downloaded_with_retries_and_a_manifest(tmp_path, monkeypatch, capsys):
    from app.scripts import download_county_acts as dl
    flaky = {"calls": 0}

    def handler(request):
        path = request.url.path
        if path == "/acts/":
            return httpx.Response(200, text=COUNTY_ACTS_PAGE)
        if path.endswith("Flaky.pdf"):
            flaky["calls"] += 1
            return httpx.Response(500) if flaky["calls"] == 1 else httpx.Response(200, content=b"%PDF-1.4 flaky")
        if path.endswith("Page.pdf"):
            return httpx.Response(200, text="<html>not a pdf</html>")
        if path.endswith("Gone.pdf"):
            return httpx.Response(404)
        return httpx.Response(200, content=b"%PDF-1.4 energy")
    patch_http(monkeypatch, dl, handler)
    monkeypatch.setattr(dl, "PAUSE_S", 0)
    assert await dl.run(tmp_path) == 1  # two Acts failed
    out = capsys.readouterr().out
    folder = tmp_path / "ncca"
    files = sorted(p.name for p in folder.glob("*.pdf"))
    assert files == ["2026-07-01_The_Nairobi_City_County_Flaky_Act_2026.pdf",
                     "2026-09-02_The_Nairobi_City_County_Energy_Act_2026.pdf",
                     "2026-09-02_The_Nairobi_City_County_Energy_Act_2026_2.pdf"]
    manifest = json.loads((folder / "manifest.json").read_text())
    assert len(manifest) == 5 and manifest[0]["url"].endswith("Energy.pdf")
    assert "no Acts page on its website" in out and "FAILED" in out and "Run the command again" in out
    assert await dl.run(tmp_path) == 1
    assert "0 downloaded, 3 already there, 2 failed" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_seed_fills_an_empty_local_database_once(db_session, monkeypatch, capsys):
    from app import seed
    monkeypatch.setattr(seed, "engine", test_engine)
    monkeypatch.setattr(seed, "async_session", TestSession)
    await seed.seed()
    assert "Seeding database" in capsys.readouterr().out
    async with TestSession() as session:
        emails = set((await session.execute(select(User.email))).scalars())
    assert {"jane@example.com", "admin@example.com", "committee@example.com"} <= emails
    await seed.seed()
    assert "already seeded" in capsys.readouterr().out


def test_seed_refuses_a_hosted_database(monkeypatch):
    from app import seed
    monkeypatch.setattr(seed, "engine", SimpleNamespace(url=SimpleNamespace(host="ep-misty.neon.tech")))
    monkeypatch.delenv("ALLOW_SEED_NON_LOCAL", raising=False)
    with pytest.raises(SystemExit, match="Refusing to seed"):
        seed.ensure_local_database()
    monkeypatch.setenv("ALLOW_SEED_NON_LOCAL", "1")
    seed.ensure_local_database()
    monkeypatch.setattr(seed, "engine", SimpleNamespace(url=SimpleNamespace(host="postgres")))
    monkeypatch.delenv("ALLOW_SEED_NON_LOCAL")
    seed.ensure_local_database()
