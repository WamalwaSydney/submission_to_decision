"""AI reading of committee reports: what happened to public submissions on a bill."""
import json

import pytest

from app.services import llm_matching_service, report_analysis_service
from app.models import SubmissionMatch
from tests.test_api import TestSession, client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_routes_workflow import API, add, bearer, bill_row, isolated_storage, person, report_for, submit, world  # noqa: F401

LONG = "The stakeholder proposed that the licence period be extended to five years. Committee Observation: the Committee agreed."


def fake_gemini(monkeypatch, decisions):
    """Replace Gemini: classify entries in order with the given decisions; anything else is a heading."""
    calls = []

    async def generate_json(system, prompt, schema, max_output_tokens=3000):
        calls.append(system)
        if system == report_analysis_service.SUMMARY_SYSTEM:
            return {"summary": "The committee adopted one proposal and rejected one."}
        import json
        entries = json.loads(prompt.split("\n", 1)[1])
        return {"items": [
            {"entry_id": e["entry_id"], "is_submission": i < len(decisions), "stakeholder": f"Org {i}", "issue": f"Issue {i}",
             "decision": decisions[i] if i < len(decisions) else "adopted", "reason": "Because"}
            for i, e in enumerate(entries)
        ] + [{"entry_id": "not-a-real-entry", "is_submission": True, "stakeholder": "x", "issue": "x", "decision": "adopted", "reason": ""}]}

    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: True)
    monkeypatch.setattr(llm_matching_service, "generate_json", generate_json)
    return calls


@pytest.mark.asyncio
async def test_classify_skips_headings_and_unknown_ids_and_cleans_decisions(monkeypatch):
    fake_gemini(monkeypatch, ["adopted", "maybe"])
    entries = [{"id": "a", "clause_ref": "Clause 1", "extracted_summary": LONG},
               {"id": "b", "clause_ref": "Clause 2", "extracted_summary": LONG},
               {"id": "c", "clause_ref": "Clause 3", "extracted_summary": "YELLOW CARD KENYA"},  # too short: never sent
               {"id": "d", "clause_ref": "Clause 4", "extracted_summary": LONG + " x" * 2000}]  # clipped, marked a heading
    items = await report_analysis_service.classify_entries(entries)
    assert [i["entry_id"] for i in items] == ["a", "b"]
    assert items[1]["decision"] == "not addressed"  # unknown decision value
    assert report_analysis_service.decision_counts(items) == {"adopted": 1, "amended": 0, "rejected": 0, "not addressed": 1}
    assert report_analysis_service._clip("x " * 2000).endswith("…")
    assert await report_analysis_service.summarise("Bill", []) is None


@pytest.mark.asyncio
async def test_summary_is_public_and_generation_is_staff_only(client, db_session, world, monkeypatch):
    bill, other = world["open_bill"], world["other_bill"]
    url = f"{API}/bills/{bill.id}/participation-summary"

    receipt = submit(client, world["citizen"], bill).json()
    empty = client.get(url).json()
    assert empty["platform"]["submissions"] == 1 and empty["report_analysis"] is None and empty["reports"] == 0

    # Generation needs staff, a configured key, and a report; the bill's own committee only for clerks.
    assert client.post(f"{url}/generate").status_code in (401, 403)
    assert client.post(f"{url}/generate", headers=bearer(world["citizen"])).status_code == 403
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: False)
    assert client.post(f"{url}/generate", headers=bearer(world["admin"])).status_code == 503
    calls = fake_gemini(monkeypatch, ["adopted", "rejected"])
    assert client.post(f"{url}/generate", headers=bearer(world["admin"])).status_code == 409
    assert client.post(f"{API}/bills/{other.id}/participation-summary/generate", headers=bearer(world["clerk"])).status_code == 403

    report, entries = await report_for(db_session, bill, [("Clause 2", LONG, "unclassified", None), ("Clause 3", LONG, "unclassified", None),
                                                          ("Clause 4", LONG, "unclassified", None)])
    await add(db_session, SubmissionMatch(receipt_ref=receipt["receipt_id"],
                                          report_entry_ref=entries[0].id, match_method="llm", confidence_score=0.9,
                                          explanation="x", reviewer_decision="confirmed"))
    made = client.post(f"{url}/generate", headers=bearer(world["clerk"]))
    assert made.status_code == 200
    analysis = made.json()["report_analysis"]
    assert analysis["submissions_recorded"] == 2 and analysis["decisions"]["adopted"] == 1 and analysis["decisions"]["rejected"] == 1
    assert analysis["summary"].startswith("The committee") and analysis["items"][0]["report_id"] == str(report.id)
    assert made.json()["platform"]["confirmed"] == 1

    # Re-running replaces the stored analysis rather than adding a second one.
    fake_gemini(monkeypatch, ["amended"])
    again = client.post(f"{url}/generate", headers=bearer(world["reviewer"])).json()["report_analysis"]
    assert again["submissions_recorded"] == 1 and again["decisions"]["amended"] == 1 and again["reports_analysed"] == 1

    # Viewing the summary never calls Gemini.
    before = len(calls)
    assert client.get(url).json()["report_analysis"]["submissions_recorded"] == 1
    assert len(calls) == before
    assert client.get(f"{API}/bills/00000000-0000-0000-0000-000000000000/participation-summary").status_code == 404
    assert client.post(f"{API}/bills/00000000-0000-0000-0000-000000000000/participation-summary/generate", headers=bearer(world["admin"])).status_code == 404


@pytest.mark.asyncio
async def test_generation_failure_keeps_the_page_working(client, db_session, world, monkeypatch):
    bill = world["open_bill"]
    await report_for(db_session, bill, [("Clause 2", LONG, "unclassified", None)])

    async def broken(*args, **kwargs):
        raise RuntimeError("Gemini request failed (503): busy")
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: True)
    monkeypatch.setattr(llm_matching_service, "generate_json", broken)
    response = client.post(f"{API}/bills/{bill.id}/participation-summary/generate", headers=bearer(world["admin"]))
    assert response.status_code == 502
    assert client.get(f"{API}/bills/{bill.id}/participation-summary").json()["report_analysis"] is None


@pytest.mark.asyncio
async def test_outcomes_list_passed_bills_first(client, db_session, world, monkeypatch):
    assert client.get(f"{API}/participation-outcomes").json() == {"bills": []}
    passed = await add(db_session, bill_row(stage="Assented", title="The Passed Bill, 2025"))
    await report_for(db_session, passed, [("Clause 1", LONG, "unclassified", None), ("Clause 2", LONG, "unclassified", None)])
    submit(client, world["citizen"], world["open_bill"])
    fake_gemini(monkeypatch, ["adopted", "rejected"])
    assert client.post(f"{API}/bills/{passed.id}/participation-summary/generate", headers=bearer(world["admin"])).status_code == 200

    rows = client.get(f"{API}/participation-outcomes").json()["bills"]
    assert [row["title"] for row in rows][0] == "The Passed Bill, 2025"
    assert rows[0]["passed"] is True and rows[0]["report"]["submissions_recorded"] == 2 and "items" not in rows[0]["report"]
    assert rows[1]["platform"]["submissions"] == 1 and rows[1]["report"] is None
    only_passed = client.get(f"{API}/participation-outcomes", params={"passed_only": True}).json()["bills"]
    assert [row["id"] for row in only_passed] == [str(passed.id)]


@pytest.mark.asyncio
async def test_gemini_dropped_connections_are_retried_then_reported(monkeypatch):
    import httpx
    attempts = []

    class FlakyClient:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *exc): return False

        async def post(self, url, headers=None, json=None):
            attempts.append(url)
            request = httpx.Request("POST", url)
            if len(attempts) == 1:
                raise httpx.RemoteProtocolError("Server disconnected without sending a response.", request=request)
            if fail_always:
                raise httpx.ReadTimeout("timed out", request=request)
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": '{"summary": "ok"}'}]}}]}, request=request)

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(llm_matching_service, "RETRY_BASE_SECONDS", 0)
    monkeypatch.setattr(llm_matching_service.httpx, "AsyncClient", FlakyClient)
    fail_always = False
    assert await llm_matching_service.generate_json("s", "p", {}) == {"summary": "ok"}
    assert len(attempts) == 2
    fail_always = True
    attempts.clear()
    with pytest.raises(RuntimeError, match="ReadTimeout"):
        await llm_matching_service.generate_json("s", "p", {})
    assert len(attempts) == llm_matching_service.RETRIES + 1


@pytest.mark.asyncio
async def test_unnamed_stakeholders_are_found_in_the_report_table_but_never_invented(monkeypatch):
    report = ("SCHEDULE OF SUBMISSIONS\nStakeholder: KENYA COFFEE PRODUCERS ASSOCIATION\n"
              "154. Amend clause 12 to require county licences for coffee millers operating in the county.\n"
              "155. Amend the Bill by deleting the clause because it is provided for under the Capital Markets Act.\n")
    items = [{"entry_id": "e1", "stakeholder": "Not named"}, {"entry_id": "e2", "stakeholder": "Not named"}, {"entry_id": "e3", "stakeholder": "CREDENCE AFRICA"}]
    entries = {"e1": "155. Amend the Bill by deleting the clause because it is provided for under the Capital Markets Act.",
               "e2": "154. Amend clause 12 to require county licences for coffee millers operating in the county."}

    async def generate_json(system, prompt, schema, max_output_tokens=3000):
        asked = json.loads(prompt.split("\n", 1)[1])
        assert all("[[SUBMISSION]]" in a["context"] for a in asked)
        return {"results": [{"id": asked[0]["id"], "stakeholder": "KENYA COFFEE PRODUCERS ASSOCIATION"},
                            {"id": asked[1]["id"], "stakeholder": "Kenya Tea Board"}]}  # not in the text: rejected
    monkeypatch.setattr(llm_matching_service, "generate_json", generate_json)
    assert await report_analysis_service.recover_names(report, items, entries) == 1
    assert items[0]["stakeholder"] == "KENYA COFFEE PRODUCERS ASSOCIATION" and items[0]["stakeholder_from"] == "report table"
    assert items[1]["stakeholder"] == "Not named" and items[2]["stakeholder"] == "CREDENCE AFRICA"
