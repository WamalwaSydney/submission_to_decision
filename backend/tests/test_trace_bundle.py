"""Copying the trace of public participation (reports, analyses, House and Act traces) to production."""
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import delete, select

from app.auth import get_password_hash
from app.models import (ActTrace, CommitteeReport, HouseTrace, LegislativeItem, ReportAnalysis, ReportEntry,
                        SubmissionMatch, User)
from app.scripts import trace_bundle
from app.services import receipt_service
from tests.test_api import TestSession, db_session  # noqa: F401  (pytest fixtures)

PDF = "https://www.parliament.go.ke/sites/default/files/report-31.pdf"
OTHER_PDF = "https://www.parliament.go.ke/sites/default/files/report-32.pdf"
COMMITTEE = "https://www.parliament.go.ke/committee/finance"


def _report(bill, url, **fields):
    return CommitteeReport(bill_ref=bill.id, institution="National Assembly", date_tabled=date(2026, 3, 1), source_document_ref=url,
                           source_url=url, committee_url=COMMITTEE, extraction_status="extracted", ocr_used=False, is_simulated=False,
                           title=f"Report {url[-6:]}", **fields)


def _entries(report, *texts):
    return [ReportEntry(report_ref=report.id, clause_ref=f"Clause {i}", extracted_summary=t, treatment="adopted") for i, t in enumerate(texts, 1)]


async def _local_world(session):
    bill = LegislativeItem(title="The Licensing Bill, 2026", identifier="NA/2026/Bill-031", institution="National Assembly", stage="Assented",
                           documents=[], status_history=[], bill_house="na", bill_number=31, bill_year=2026)
    session.add(bill)
    await session.flush()
    first, second = _report(bill, PDF, extracted_text="report text"), _report(bill, OTHER_PDF, extracted_text="second report")
    session.add_all([first, second])
    await session.flush()
    entries = _entries(first, "Licences last five years.", "Publish the register.") + _entries(second, "A third view.")
    session.add_all(entries)
    await session.flush()
    key = f"{first.id}:{entries[0].id}"
    session.add_all([
        ReportAnalysis(report_ref=first.id, model="gemini", entries_analysed=2, summary="s", submitters=[],
                       items=[{"entry_id": str(entries[0].id), "stakeholder": "A", "decision": "adopted"}]),
        HouseTrace(bill_ref=bill.id, sittings=[{"date": "2026-04-01"}], hansard_text="hansard", model="gemini",
                   items=[{"key": key, "decision": "agreed"}], checked_at=datetime(2026, 4, 2, tzinfo=timezone.utc)),
        ActTrace(bill_ref=bill.id, act_title="The Licensing Act, 2026", act_text="ACT " * 200, act_url="https://kenyalaw.org/akn/ke/act/2026/1",
                 storage_ref="/local/act.pdf", model="gemini", items=[{"key": key, "status": "in_act"}], checked_at=datetime(2026, 5, 1, tzinfo=timezone.utc)),
    ])
    await session.commit()
    return bill, first, second, entries


async def _wipe_traces(session):
    for model in (SubmissionMatch, ReportAnalysis, HouseTrace, ActTrace, ReportEntry, CommitteeReport):
        await session.execute(delete(model))
    await session.commit()


@pytest.mark.asyncio
async def test_the_whole_trace_reaches_production_under_production_ids(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(trace_bundle, "async_session", TestSession)
    async with TestSession() as session:
        bill, first, second, entries = await _local_world(session)
        simulated = LegislativeItem(title="Seed Bill", identifier="NA/2026/Bill-999", institution="National Assembly", stage="Assented",
                                    documents=[], status_history=[], is_simulated=True)
        session.add(simulated)
        await session.flush()
        session.add(HouseTrace(bill_ref=simulated.id, sittings=[], items=[]))  # seed data never leaves this machine
        await session.commit()
    bundle = tmp_path / "bundle.json.gz"
    assert await trace_bundle.export(bundle) == {"reports": 2, "entries": 3, "analyses": 1, "house": 1, "acts": 1}

    # Production: its own sync stored the first report under another id, with the same entries under other ids.
    async with TestSession() as session:
        await _wipe_traces(session)
        theirs = _report(bill, PDF)
        session.add(theirs)
        await session.flush()
        their_entries = _entries(theirs, "Licences last five years.", "Publish the register.")
        session.add_all(their_entries)
        await session.commit()

    counts = await trace_bundle.import_(bundle)
    assert counts["reports_added"] == 1 and counts["reports_matched"] == 1 and counts["entries_added"] == 1
    assert (counts["analyses"], counts["house"], counts["acts"], counts["needs_a_person"]) == (1, 1, 1, 0)
    async with TestSession() as session:
        analysis = (await session.execute(select(ReportAnalysis))).scalar_one()
        house = (await session.execute(select(HouseTrace))).scalar_one()
        act = (await session.execute(select(ActTrace))).scalar_one()
        matched = await session.get(CommitteeReport, theirs.id)
        added = await session.get(CommitteeReport, second.id)  # not there before: kept its id
    their_key = f"{theirs.id}:{their_entries[0].id}"
    assert analysis.report_ref == theirs.id and analysis.items[0]["entry_id"] == str(their_entries[0].id)
    assert house.items[0]["key"] == their_key and act.items[0]["key"] == their_key
    assert matched.extracted_text == "report text"  # production had no text yet
    assert added.bill_ref == bill.id and act.storage_ref is None and act.act_text.startswith("ACT")

    # Running it again keeps what is there; --replace refreshes it.
    again = await trace_bundle.import_(bundle)
    assert (again["reports_added"], again["analyses"], again["house_kept"], again["acts_kept"]) == (0, 0, 1, 1)
    assert (await trace_bundle.import_(bundle, replace=True))["acts"] == 1


@pytest.mark.asyncio
async def test_entries_already_matched_to_submissions_are_never_replaced(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(trace_bundle, "async_session", TestSession)
    async with TestSession() as session:
        bill, *_ = await _local_world(session)
    bundle = tmp_path / "bundle.json.gz"
    await trace_bundle.export(bundle)
    async with TestSession() as session:
        await _wipe_traces(session)
        theirs = _report(bill, PDF)
        session.add(theirs)
        await session.flush()
        entry = _entries(theirs, "Different wording read by another OCR run.")[0]
        session.add(entry)
        citizen = User(name="Achieng", email=f"c-{uuid.uuid4().hex[:6]}@example.com", role="citizen",
                       password_hash=get_password_hash("password123"), status="active")
        session.add(citizen)
        await session.commit()
        receipt = await receipt_service.create_receipt(session, author_id=citizen.id, legislative_item_id=bill.id, clause_ref=None,
                                                       submission_text="Licences should last longer.", public_id=f"RCT-B{uuid.uuid4().hex[:4].upper()}")
        session.add(SubmissionMatch(receipt_ref=receipt.id, report_entry_ref=entry.id, match_method="llm", confidence_score=0.9,
                                    explanation="matched", reviewer_decision="confirmed"))
        await session.commit()

    counts = await trace_bundle.import_(bundle)
    assert counts["needs_a_person"] == 1 and counts["reports_added"] == 1
    async with TestSession() as session:
        kept = (await session.execute(select(ReportEntry).where(ReportEntry.report_ref == theirs.id))).scalars().all()
        analysis = (await session.execute(select(ReportAnalysis).where(ReportAnalysis.report_ref == theirs.id))).scalar_one_or_none()
    assert [e.id for e in kept] == [entry.id] and analysis is None


@pytest.mark.asyncio
async def test_unused_entries_that_differ_are_replaced_and_bad_bundles_refused(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(trace_bundle, "async_session", TestSession)
    async with TestSession() as session:
        bill, *_ = await _local_world(session)
    bundle = tmp_path / "bundle.json.gz"
    await trace_bundle.export(bundle)
    async with TestSession() as session:
        await _wipe_traces(session)
        theirs = _report(bill, PDF)
        session.add(theirs)
        await session.flush()
        session.add(_entries(theirs, "Partial OCR text.")[0])
        await session.commit()
    assert (await trace_bundle.import_(bundle))["needs_a_person"] == 0
    async with TestSession() as session:
        summaries = sorted(e.extracted_summary for e in (await session.execute(select(ReportEntry).where(ReportEntry.report_ref == theirs.id))).scalars())
    assert summaries == ["Licences last five years.", "Publish the register."]

    import gzip
    import json
    old = tmp_path / "old.json.gz"
    with gzip.open(old, "wt") as handle:
        json.dump({"version": 0}, handle)
    with pytest.raises(SystemExit):
        await trace_bundle.import_(old)


def test_ids_inside_json_are_rewritten():
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    assert trace_bundle.remap({f"{a}:x": [a, {"entry_id": a, "n": 1}]}, {a: b}) == {f"{b}:x": [b, {"entry_id": b, "n": 1}]}
    assert trace_bundle.remap([a], {}) == [a]
