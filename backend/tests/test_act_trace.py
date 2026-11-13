"""Tracing committee recommendations into the final Act."""
import json

import pytest

from app.services import act_trace_service, evidence, house_trace_service, ingestion_service, llm_matching_service
from tests.test_api import TestSession, client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_report_analysis import LONG, fake_gemini
from tests.test_routes_workflow import API, add, bearer, bill_row, isolated_storage, report_for, world  # noqa: F401

ACT = ("THE VIRTUAL ASSET SERVICE PROVIDERS ACT No. 20 of 2025. "
       "12. (3) A licence issued under this Act shall be valid for a period of five years from the date of issue. "
       "14. The Authority shall publish the register of licensees on its website every quarter.")
BILL = ("THE VIRTUAL ASSET SERVICE PROVIDERS BILL, 2025. 12. (3) A licence shall be valid for a period of one year. "
        "14. The Authority shall publish the register of licensees on its website every quarter.")

def verdicts(prompt, verdict="yes"):
    """Fake answer for the independent check."""
    return {"results": [{"id": i["id"], "verdict": verdict, "reason": "checked"} for i in json.loads(prompt.split("\n", 1)[1])]}


LISTING = """
<td class="cell-title"><a href="/akn/ke/act/2025/20/eng@2025-11-04" data-key-link="document">Virtual Asset Service Providers Act</a></td>
<td class="cell-title"><a href="/akn/ke/act/ln/2026/134/eng@2026-07-22">The Virtual Asset Service Providers Regulations, 2026</a></td>
<td class="cell-title"><a href="/akn/ke/act/2025/18/eng@2026-03-25" data-key-link="document">Privatization Act</a></td>
"""


def test_kenya_law_listing_and_matching():
    acts = act_trace_service.parse_kenya_law_listing(LISTING)
    assert [(a["title"], a["citation"]) for a in acts] == [("Virtual Asset Service Providers Act", "Act No. 20 of 2025"),
                                                         ("Privatization Act", "Act No. 18 of 2025")]
    assert acts[0]["url"] == "https://kenyalaw.org/akn/ke/act/2025/20/eng@2025-11-04"
    assert act_trace_service.match_act("The Virtual Asset Service Providers Bill, 2025", 2025, acts)["citation"] == "Act No. 20 of 2025"
    assert act_trace_service.match_act("The Privatization Bill, 2023", 2023, acts)["citation"] == "Act No. 18 of 2025"  # Acts can follow by a few years
    assert act_trace_service.match_act("The Privatization Bill, 2020", 2020, acts) is None  # too far apart
    twice = acts + [{**acts[0], "url": "other"}]
    assert act_trace_service.match_act("The Virtual Asset Service Providers Bill, 2025", 2025, twice) is None  # ambiguous


def test_quotes_are_checked_against_the_act_and_the_bill():
    good = {"status": "in_act", "section": "s. 12(3)", "quote": "shall be valid for a period of five years", "explanation": "Extended."}
    assert act_trace_service.check_result(good, ACT, BILL)["status"] == "in_act"
    invented = {**good, "quote": "shall be valid for a period of ten years"}
    checked = act_trace_service.check_result(invented, ACT, BILL)
    assert checked["status"] == "unclear" and not checked["quote_verified"] and checked["problem"] == "bad_lines"
    ocr = "12. (3) A licence issucd under this Act shall be valid for a period of fivc years from the date of issue."
    near = act_trace_service.check_result({**good, "quote": "A licence issued under this Act shall be valid for a period of five years"}, ocr, BILL)
    assert near["status"] == "in_act" and near["act_span"].startswith("A licence issucd")  # OCR typos tolerated; the Act's own wording kept
    removed_ok = {"status": "in_act", "removed_wording": "A licence shall be valid for a period of one year", "explanation": "Deleted."}
    assert act_trace_service.check_result(removed_ok, ACT, BILL)["evidence"] == "removed"
    assert act_trace_service.check_result(removed_ok, ACT, None)["status"] == "unclear"  # cannot check without the bill
    still_there = {**removed_ok, "removed_wording": "publish the register of licensees on its website every quarter"}
    assert act_trace_service.check_result(still_there, ACT, BILL)["status"] == "unclear"
    unchanged = {**good, "quote": "publish the register of licensees on its website every quarter"}
    assert "already in the bill" in act_trace_service.check_result(unchanged, ACT, BILL)["explanation"]
    assert act_trace_service.check_result({**good, "status": "maybe"}, ACT, BILL)["status"] == "unclear"
    assert act_trace_service.check_result({"status": "not_in_act", "explanation": "Not there."}, ACT, None)["status"] == "not_in_act"


@pytest.mark.asyncio
async def test_trace_only_checks_adopted_recommendations(monkeypatch):
    items = [{"report_id": "r", "entry_id": str(i), "decision": d, "issue": f"x{i}", "reason": "y"} for i, d in enumerate(["adopted", "rejected", "amended"])]
    items.append({"report_id": "r2", "entry_id": "0", "decision": "adopted", "issue": "x0", "reason": "y"})  # same item in a second report version
    seen = {}

    async def generate_json(system, prompt, schema, max_output_tokens=3000):
        if system == evidence.VERIFY_SYSTEM:
            return verdicts(prompt)
        payload = json.loads(prompt.split("\n")[1])
        seen.setdefault("ids", [r["id"] for r in payload["recommendations"]])
        return {"results": [{"id": "0", "status": "in_act", "section": "s. 12(3)", "quote": "valid for a period of five years from the date", "explanation": "ok"},
                            {"id": "99", "status": "in_act", "explanation": "unknown id"}]}
    monkeypatch.setattr(llm_matching_service, "generate_json", generate_json)
    results = await act_trace_service.trace(items, ACT, "Bill", BILL)
    assert seen["ids"] == ["0", "1"]  # the rejected item is not sent
    assert {r["key"]: r["status"] for r in results} == {"r:0": "in_act", "r2:0": "in_act", "r:2": "unclear"}  # duplicate shares the answer
    assert act_trace_service.counts(results) == {"in_act": 2, "not_in_act": 0, "unclear": 1}


@pytest.mark.asyncio
async def test_final_act_upload_is_staff_only_and_traces_recommendations(client, db_session, world, isolated_storage, monkeypatch):
    law = await add(db_session, bill_row(stage="Assented", title="The Virtual Asset Service Providers Bill, 2025", committee_id=world["health"].id))
    url = f"{API}/bills/{law.id}/final-act"
    pdf = {"file": ("act.pdf", b"%PDF-1.4 act", "application/pdf")}

    assert client.post(url, files=pdf).status_code in (401, 403)
    assert client.post(url, files=pdf, headers=bearer(world["citizen"])).status_code == 403
    assert client.post(f"{API}/bills/{world['open_bill'].id}/final-act", files=pdf, headers=bearer(world["admin"])).status_code == 409
    assert client.post(url, files={"file": ("act.txt", b"plain text", "text/plain")}, headers=bearer(world["admin"])).status_code == 422
    assert client.post(url, files=pdf, data={"act_url": "https://evil.example/act"}, headers=bearer(world["admin"])).status_code == 422

    # The committee report has been read: one adopted and one rejected recommendation.
    await report_for(db_session, law, [("Clause 12", LONG, "unclassified", None), ("Clause 14", LONG, "unclassified", None)])
    fake_gemini(monkeypatch, ["adopted", "rejected"])
    assert client.post(f"{url}/check", headers=bearer(world["admin"])).status_code == 409  # nothing uploaded yet
    assert client.post(f"{API}/bills/{law.id}/participation-summary/generate", headers=bearer(world["admin"])).status_code == 200

    monkeypatch.setattr(ingestion_service, "extract_text", lambda path: (ACT * 10, False))

    async def no_bill_text(documents):
        return BILL
    monkeypatch.setattr(act_trace_service, "fetch_bill_text", no_bill_text)

    async def generate_json(system, prompt, schema, max_output_tokens=3000):
        if system == evidence.VERIFY_SYSTEM:
            return verdicts(prompt)
        payload = json.loads(prompt.split("\n")[1])
        assert "=== BILL AS FIRST PUBLISHED ===" in prompt and "B1: THE VIRTUAL ASSET" in prompt
        return {"results": [{"id": r["id"], "status": "in_act", "section": "s. 12(3)", "quote": "valid for a period of five years", "explanation": "Extended to five years."}
                            for r in payload["recommendations"]]}
    monkeypatch.setattr(llm_matching_service, "generate_json", generate_json)

    made = client.post(url, files=pdf, data={"act_url": "https://kenyalaw.org/akn/ke/act/2025/20/eng@2025-11-04"}, headers=bearer(world["clerk"]))
    assert made.status_code == 200, made.text
    final = made.json()["final_act"]
    assert final["title"] == "The Virtual Asset Service Providers Act, 2025" and final["has_text"] is True
    assert final["counts"] == {"in_act": 1, "not_in_act": 0, "unclear": 0} and final["items"][0]["section"] == "s. 12(3)"

    public = client.get(f"{API}/bills/{law.id}/participation-summary").json()["final_act"]
    assert public["counts"]["in_act"] == 1 and "act_text" not in public

    # A failed re-check keeps the Act and the earlier result.
    async def broken(*args, **kwargs):
        raise RuntimeError("Gemini request failed (503)")
    monkeypatch.setattr(llm_matching_service, "generate_json", broken)
    assert client.post(f"{url}/check", headers=bearer(world["reviewer"])).status_code == 502
    assert client.get(f"{API}/bills/{law.id}/participation-summary").json()["final_act"]["counts"]["in_act"] == 1


def test_no_2_bills_match_their_act_when_unambiguous():
    acts = [{"title": "Tax Procedures (Amendment) Act", "url": "u1", "citation": "Act No. 21 of 2024", "year": 2024}]
    assert act_trace_service.match_act("The Tax Procedures (Amendment) (No.2) Bill, 2024", 2024, acts)["citation"] == "Act No. 21 of 2024"
    two = acts + [{"title": "Tax Procedures (Amendment) (No. 3) Act", "url": "u2", "citation": "Act No. 30 of 2024", "year": 2024}]
    assert act_trace_service.match_act("The Tax Procedures (Amendment) (No.2) Bill, 2024", 2024, two) is None


@pytest.mark.asyncio
async def test_act_text_comes_from_laws_africa_with_a_token(monkeypatch):
    import httpx
    seen = {}

    def handler(request):
        seen["url"], seen["auth"] = str(request.url), request.headers.get("Authorization")
        return httpx.Response(200, text="<div><h2>PART I</h2><section><span class='akn-num'>12.</span><p>" + "A licence shall be valid for five years. " * 20 + "</p></section><script>x()</script></div>")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.delenv("LAWS_AFRICA_TOKEN", raising=False)
    assert await act_trace_service.fetch_act_text("https://kenyalaw.org/akn/ke/act/2025/20/eng@2025-11-04", client) is None
    monkeypatch.setenv("LAWS_AFRICA_TOKEN", "secret")
    text = await act_trace_service.fetch_act_text("https://kenyalaw.org/akn/ke/act/2025/20/eng@2025-11-04", client)
    assert seen["url"].endswith("/akn/ke/act/2025/20/eng@2025-11-04.html") and seen["auth"] == "Token secret"
    assert text.startswith("PART I") and "x()" not in text and "valid for five years" in text
    monkeypatch.setattr(act_trace_service, "LAWS_AFRICA_API", "https://api.example")
    client2 = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401)))
    with pytest.raises(RuntimeError, match="HTTP 401"):
        await act_trace_service.fetch_act_text("https://kenyalaw.org/akn/ke/act/2025/20/eng@2025-11-04", client2)


@pytest.mark.asyncio
async def test_act_reader_serves_text_and_pdf_publicly(client, db_session, world, isolated_storage, monkeypatch):
    from app.models import ActTrace
    from app.services import storage_service
    law = await add(db_session, bill_row(stage="Assented", title="The Reader Bill, 2025"))
    assert client.get(f"{API}/bills/{law.id}/final-act/text").status_code == 404
    assert client.get(f"{API}/bills/{law.id}/final-act/document").status_code == 404
    stored = storage_service.persist_report(b"%PDF-1.4 act", "act.pdf")
    await add(db_session, ActTrace(bill_ref=law.id, act_title="The Reader Act, 2025", act_text=ACT, storage_ref=stored["storage_ref"],
                                   items=[{"key": "r:1", "status": "in_act", "section": "s. 12(3)", "quote": "valid for a period of five years",
                                           "quote_verified": True, "explanation": "ok"}]))
    body = client.get(f"{API}/bills/{law.id}/final-act/text").json()
    assert body["text"] == ACT and body["has_pdf"] is True and body["act"]["title"] == "The Reader Act, 2025"
    pdf = client.get(f"{API}/bills/{law.id}/final-act/document")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and "Reader_Act" in pdf.headers["content-disposition"]


def test_line_evidence_kept_and_deleted():
    from app.services import evidence
    act = "PART I\n12. (3) A licence issued under this Act shall be valid for a period of five years from the date of issue.\n14. The Authority shall publish the register of licensees on its website every quarter."
    bill = "PART I\n12. (3) A licence shall be valid for a period of one year.\n13. The Authority may charge a fee for every licence application made under this Part of the Bill.\n14. The Authority shall publish the register of licensees on its website every quarter."
    al, bl = evidence.lines_of(act), evidence.lines_of(bill)
    assert evidence.parse_range("A2-A3", len(al), 12) == (1, 2) and evidence.parse_range("A2-A30", len(al), 12) is None
    changed = act_trace_service.check_result({"status": "in_act", "change": "changed", "act_lines": "A2"}, act, bill, {}, al, bl)
    assert changed["evidence"] == "changed" and changed["act_span"].startswith("12. (3) A licence issued")
    # Renumbered but unchanged wording is not a change...
    kept_no_support = act_trace_service.check_result({"status": "in_act", "change": "kept", "act_lines": "A3"}, act, bill, {"issue": "Asked for quarterly publication"}, al, bl)
    assert kept_no_support["status"] == "unclear" and kept_no_support["problem"] == "already_in_bill"
    labelled_changed = act_trace_service.check_result({"status": "in_act", "change": "changed", "act_lines": "A3"}, act, bill, {"issue": "The bank supported quarterly publication"}, al, bl)
    assert labelled_changed["evidence"] == "kept"  # supported and unchanged counts, whatever the label
    # ...unless the stakeholder supported the bill's own wording.
    kept = act_trace_service.check_result({"status": "in_act", "change": "kept", "act_lines": "A3"}, act, bill, {"issue": "The bank supported quarterly publication"}, al, bl)
    assert kept["status"] == "in_act" and kept["evidence"] == "kept"
    deleted = act_trace_service.check_result({"status": "in_act", "change": "deleted", "bill_lines": "B3"}, act, bill, {}, al, bl)
    assert deleted["evidence"] == "removed" and deleted["removed_wording"].startswith("13. The Authority may charge")
    not_deleted = act_trace_service.check_result({"status": "in_act", "change": "deleted", "bill_lines": "B4"}, act, bill, {}, al, bl)
    assert not_deleted["status"] == "unclear" and not_deleted["problem"] == "still_in_act"
    assert act_trace_service.check_result({"status": "in_act", "act_lines": "A99"}, act, bill, {}, al, bl)["problem"] == "bad_lines"


@pytest.mark.asyncio
async def test_failed_evidence_is_retried_once_with_the_reason(monkeypatch):
    act = "12. A licence issued under this Act shall be valid for a period of five years from the date of issue.\n14. The Authority shall publish the register of licensees on its website every quarter."
    bill = "12. A licence shall be valid for a period of one year.\n14. The Authority shall publish the register of licensees on its website every quarter."
    items = [{"report_id": "r", "entry_id": "1", "decision": "adopted", "issue": "Extend licences to five years", "reason": "Agreed"}]
    prompts = []

    async def generate_json(system, prompt, schema, max_output_tokens=3000):
        if system == evidence.VERIFY_SYSTEM:
            return verdicts(prompt)
        prompts.append(prompt)
        lines = "A2" if len(prompts) == 1 else "A1"  # first answer cites unchanged wording
        return {"results": [{"id": "0", "status": "in_act", "change": "changed", "act_lines": lines, "section": "s. 12", "explanation": "ok"}]}
    monkeypatch.setattr(llm_matching_service, "generate_json", generate_json)
    results = await act_trace_service.trace(items, act, "Bill", bill)
    assert len(prompts) == 2 and "were already in the bill as published" in prompts[1]
    assert results[0]["status"] == "in_act" and results[0]["act_span"].startswith("12. A licence issued")



@pytest.mark.asyncio
async def test_a_change_that_does_not_carry_out_the_recommendation_is_not_confirmed(monkeypatch):
    act = "5. The regulatory authorities are the Capital Markets Authority and the Central Bank of Kenya and the Virtual Assets Office."
    bill = "5. The regulatory authorities are the Capital Markets Authority and the Central Bank of Kenya."
    items = [{"report_id": "r", "entry_id": "1", "decision": "adopted", "issue": "Remove the Capital Markets Authority and create one regulator", "reason": "Agreed"}]
    seen = []

    async def generate_json(system, prompt, schema, max_output_tokens=3000):
        if system == evidence.VERIFY_SYSTEM:
            seen.append(prompt)
            return verdicts(prompt, "no")
        return {"results": [{"id": "0", "status": "in_act", "change": "changed", "act_lines": "A1", "bill_lines": "B1", "explanation": "s. 5"}]}
    monkeypatch.setattr(llm_matching_service, "generate_json", generate_json)
    result = (await act_trace_service.trace(items, act, "Bill", bill))[0]
    assert json.loads(seen[0].split("\n", 1)[1])[0]["evidence"] == 'ADDED: "and the Virtual Assets Office"'  # only the real difference
    assert result["status"] == "unclear" and "does not carry out" in result["explanation"]
    # Without the bill as published, a change cannot be seen, so it is not confirmed.
    no_bill = (await act_trace_service.trace(items, act, "Bill", None))[0]
    assert no_bill["status"] == "unclear" and "not available" in no_bill["explanation"]


HANSARD = """=== SITTING: Thursday, 2nd October, 2025 National Assembly (https://mzalendo.com/democracy-tools/hansard/document/1/) ===
VIRTUAL ASSET SERVICE PROVIDERS BILL
(National Assembly Bill No. 15 of 2025)
Clause 5
Hon. Kuria Kimani: I beg to move THAT, Clause 5 of the Bill be amended by deleting the words "For avoidance of doubt".
(Question, that the words to be left out be left out, put and agreed to)
(Clause 5 as amended agreed to)
(Clauses 29, 30, 31 and 32 agreed to)
Clause 40
Hon. Kuria Kimani: I beg to move THAT, Clause 40 of the Bill be amended by deleting subclause (2).
(Question, that the words to be left out be left out, put and negatived)"""


def test_house_decisions_need_the_right_clause_and_a_real_decision():
    lines = evidence.lines_of(HANSARD)
    sittings = [{"id": 1, "url": "https://mzalendo.com/democracy-tools/hansard/document/1/", "title": "Thursday"}]
    agreed = house_trace_service.check_result({"decision": "agreed", "lines": "H4-H7"}, HANSARD, lines, sittings, {"clause_ref": "Clause 5"})
    assert agreed["decision"] == "agreed" and agreed["sitting"]["id"] == 1 and "I beg to move" in agreed["excerpt"]
    wrong = house_trace_service.check_result({"decision": "agreed", "lines": "H4-H7"}, HANSARD, lines, sittings, {"clause_ref": "Clause 3(2)"})
    assert wrong["decision"] == "unclear" and wrong["problem"] == "wrong_clause"
    # "(Clauses 29, ... 31 ... agreed to)" means passed without amendment, never "agreed" to a change.
    as_agreed = house_trace_service.check_result({"decision": "agreed", "lines": "H8"}, HANSARD, lines, sittings, {"clause_ref": "Clause 31"})
    assert as_agreed["decision"] == "unclear"
    unchanged = house_trace_service.check_result({"decision": "unchanged", "lines": "H8"}, HANSARD, lines, sittings, {"clause_ref": "Clause 31"})
    assert unchanged["decision"] == "unchanged"
    negatived = house_trace_service.check_result({"decision": "negatived", "lines": "H9-H11"}, HANSARD, lines, sittings, {"clause_ref": "Clause 40"})
    assert negatived["decision"] == "negatived"
    assert house_trace_service.check_result({"decision": "negatived", "lines": "H4-H7"}, HANSARD, lines, sittings, {})["problem"] == "bad_lines"


def test_hansard_segments_are_matched_by_bill_number():
    page = """<div>IN THE COMMITTEE</div><div>VIRTUAL ASSET SERVICE PROVIDERS BILL</div>
<p>Contents</p>
<div>IN THE COMMITTEE</div><div>[The Temporary Chairman (Hon. Farah Maalim) in the Chair]</div>
<div>VIRTUAL ASSET SERVICE PROVIDERS (AMENDMENT) BILL</div>
<div>(National Assembly Bill No. 15 of 2025) We are in Committee.</div>
<div>(Clause 5 as amended agreed to)</div>
<div>THE KENYA ROADS BILL</div>
<div>(National Assembly Bill No. 30 of 2025) Next bill.</div>
<div>(Clause 2 agreed to)</div>
<div>IN THE HOUSE</div><div>Other business</div>"""
    text = house_trace_service.page_text(page)
    vasp = house_trace_service.bill_segments(text, "na", 15, 2025, "The Virtual Asset Service Providers Bill, 2025")
    assert len(vasp) == 1 and "Clause 5 as amended" in vasp[0] and "KENYA ROADS" not in vasp[0]
    assert house_trace_service.bill_segments(text, "na", 16, 2025, "Other Bill") == []
    links = house_trace_service.sitting_links('<a href="/democracy-tools/hansard/document/1585/">Thursday, 2nd October, 2025 - Afternoon Sitting National Assembly</a>'
                                              '<a href="/democracy-tools/hansard/document/2036/">Thursday, 2nd October, 2025 Senate</a>', "National Assembly")
    assert [l["id"] for l in links] == [1585]
    assert house_trace_service.committee_dates([{"stage": "Committee of the Whole House", "date": "2025-10-02"}, {"stage": "Third Reading", "date": "2025-10-07"}]) == [__import__("datetime").date(2025, 10, 2)]


@pytest.mark.asyncio
async def test_a_platform_receipt_follows_its_report_entry_through_the_house_and_into_the_act(client, db_session, world, monkeypatch):
    from app.models import ActTrace, HouseTrace, SubmissionMatch
    from tests.test_routes_workflow import submit
    bill = world["open_bill"]
    receipt = submit(client, world["citizen"], bill, text="Licences should last five years, not one.").json()
    report, entries = await report_for(db_session, bill, [("Clause 12", LONG, "unclassified", None), ("Clause 14", LONG, "unclassified", None)])
    fake_gemini(monkeypatch, ["adopted", "rejected"])
    assert client.post(f"{API}/bills/{bill.id}/participation-summary/generate", headers=bearer(world["admin"])).status_code == 200
    key = f"{report.id}:{entries[0].id}"
    await add(db_session, HouseTrace(bill_ref=bill.id, sittings=[], hansard_text="x", items=[
        {"key": key, "decision": "agreed", "clause": "Clause 12", "excerpt": "I beg to move ... agreed to", "sitting": None, "explanation": "Agreed."}]))
    await add(db_session, ActTrace(bill_ref=bill.id, act_title="The Test Act", act_text=ACT, items=[
        {"key": key, "status": "in_act", "section": "s. 12(3)", "act_span": "valid for a period of five years", "quote": "valid for a period of five years",
         "quote_verified": True, "evidence": "changed", "explanation": "Extended."}]))

    # Before a moderator confirms the match, the receipt has no trace.
    assert client.get(f"{API}/receipts/{receipt['public_id']}").json()["trace"] is None
    await add(db_session, SubmissionMatch(receipt_ref=receipt["receipt_id"], report_entry_ref=entries[0].id, match_method="llm",
                                          confidence_score=0.9, explanation="Same request", reviewer_decision="confirmed"))
    trace = client.get(f"{API}/receipts/{receipt['public_id']}").json()["trace"]
    assert trace["key"] == key and trace["committee"]["decision"] == "adopted"
    assert trace["house"]["decision"] == "agreed" and trace["act"]["status"] == "in_act" and trace["final_act"]["title"] == "The Test Act"
    # The bill page shows the report entry with the receipt that joined it.
    links = client.get(f"{API}/bills/{bill.id}/participation-summary").json()["platform_links"]
    assert links == {key: [receipt["public_id"]]}


@pytest.mark.asyncio
async def test_a_clerk_recording_a_call_for_views_opens_a_first_reading_bill(client, db_session, world):
    from datetime import date, timedelta
    from tests.test_routes_workflow import submit
    bill = await add(db_session, bill_row(stage="First Reading", committee_id=world["health"].id))
    assert submit(client, world["citizen"], bill).status_code == 409  # waits for the committee's call
    today = date.today()
    made = client.post(f"{API}/notices", headers=bearer(world["clerk"]), data={
        "bill_ref": str(bill.id), "institution": "National Assembly", "notice_date": today.isoformat(),
        "window_start": today.isoformat(), "window_end": (today + timedelta(days=3)).isoformat(), "mode": "Website", "bill_text_accessible": "true"})
    assert made.status_code == 200, made.text
    shown = client.get(f"{API}/bills/{bill.id}/flow").json()["bill"]
    assert shown["stage"] == "Public participation" and shown["participation"]["accepting"] is True
    assert submit(client, world["citizen"], bill).status_code == 200
