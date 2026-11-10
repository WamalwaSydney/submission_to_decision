"""From report entries to match proposals: Gemini proposals, abstention, the outage
fallback, report-reference checks, and moderator decisions. Gemini is always faked."""
import uuid
from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.auth import get_password_hash
from app.models import CommitteeReport, LegislativeItem, Message, ReportEntry, SubmissionMatch, User
from app.services import linking_service, llm_matching_service, receipt_service
from tests.test_api import client, db_session  # noqa: F401  (pytest fixtures)


@pytest_asyncio.fixture
async def setup(db_session):
    citizen = User(name="Achieng", email=f"c-{uuid.uuid4().hex[:6]}@example.com", role="citizen",
                   password_hash=get_password_hash("password123"), status="active")
    reviewer = User(name="Mod", email=f"m-{uuid.uuid4().hex[:6]}@example.com", role="reviewer",
                    password_hash=get_password_hash("password123"), status="active")
    bill = LegislativeItem(title="The Licensing Bill, 2026", identifier="NA/2026/Bill-031", institution="National Assembly",
                           stage="Committee Stage", documents=[], status_history=[], bill_house="NA", bill_number=31, bill_year=2026)
    db_session.add_all([citizen, reviewer, bill])
    await db_session.commit()
    report = CommitteeReport(bill_ref=bill.id, institution="National Assembly", date_tabled=date(2026, 3, 1),
                             source_document_ref="r.pdf", extraction_status="extracted", ocr_used=False,
                             bill_house="National Assembly", bill_number=31, bill_year=2026)
    db_session.add(report)
    await db_session.flush()
    licence = ReportEntry(report_ref=report.id, clause_ref="Clause 14", treatment="amended",
                          extracted_summary="Clause 14 licence validity period for virtual asset providers was amended.",
                          stated_reason="Providers need continuity")
    register = ReportEntry(report_ref=report.id, clause_ref="Clause 18", treatment="adopted",
                           extracted_summary="Public register of licensed providers must be published online.")
    db_session.add_all([licence, register])
    await db_session.commit()
    receipts = []
    for i, text in enumerate([
        "Clause 14 licence validity period should not force providers to stop operating.",
        "Please publish an online register of licensed providers.",
    ]):
        receipts.append(await receipt_service.create_receipt(
            db_session, author_id=citizen.id, legislative_item_id=bill.id, clause_ref=None,
            submission_text=text, public_id=f"RCT-TEST{i}{uuid.uuid4().hex[:2].upper()}"))
    return {"citizen": citizen, "reviewer": reviewer, "bill": bill, "report": report,
            "entries": {"licence": licence, "register": register}, "receipts": receipts}


def fake_gemini(monkeypatch, proposals=None, error=None):
    """Make Gemini look configured and return fixed proposals (or fail)."""
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: True)

    async def propose(receipts, entries):
        if error:
            raise error
        return proposals(receipts, entries) if callable(proposals) else (proposals or [])
    monkeypatch.setattr(llm_matching_service, "propose_matches", propose)


async def matches_for(db_session, receipt):
    rows = await db_session.execute(select(SubmissionMatch).where(SubmissionMatch.receipt_ref == receipt.id))
    return list(rows.scalars().all())


async def messages_of(db_session, user):
    rows = await db_session.execute(select(Message).where(Message.recipient_user_id == user.id))
    return [m.message_type for m in rows.scalars().all()]


@pytest.mark.asyncio
async def test_gemini_proposals_are_saved_as_pending_and_citizens_told(db_session, monkeypatch, setup):
    first, second = setup["receipts"]
    licence = setup["entries"]["licence"]
    fake_gemini(monkeypatch, [
        {"receipt_id": str(first.id), "entry_id": str(licence.id), "confidence": 0.93, "explanation": "Same clause."},
        {"receipt_id": str(first.id), "entry_id": str(licence.id), "confidence": 0.5, "explanation": "Duplicate ignored."},
        {"receipt_id": str(uuid.uuid4()), "entry_id": str(licence.id), "confidence": 0.9, "explanation": "Unknown receipt."},
    ])
    created = await linking_service.propose_matches(db_session, setup["bill"].id)
    assert len(created) == 1
    [match] = await matches_for(db_session, first)
    assert (match.match_method, match.reviewer_decision, match.confidence_score) == ("llm", "pending", 0.93)
    assert match.explanation.startswith("Gemini proposal (93.0%)")
    # Gemini abstained on the second receipt: no lexical guess replaces that.
    assert await matches_for(db_session, second) == []
    kinds = await messages_of(db_session, setup["citizen"])
    assert "match_pending" in kinds and "no_match_yet" in kinds

    # Running again neither duplicates the proposal nor re-notifies.
    assert await linking_service.propose_matches(db_session, setup["bill"].id) == []
    assert len(await matches_for(db_session, first)) == 1


@pytest.mark.asyncio
async def test_gemini_outage_falls_back_to_labelled_text_similarity(db_session, monkeypatch, setup):
    first, second = setup["receipts"]
    fake_gemini(monkeypatch, error=RuntimeError("Gemini request failed (503)"))
    created = await linking_service.propose_matches(db_session, setup["bill"].id)
    assert created, "the fallback should still propose matches for moderators"
    for match in created:
        assert match.match_method == "text-similarity" and match.reviewer_decision == "pending"
        assert "Gemini was unavailable" in match.explanation


@pytest.mark.asyncio
async def test_without_gemini_configured_text_similarity_is_used(db_session, monkeypatch, setup):
    monkeypatch.setattr(llm_matching_service, "is_configured", lambda: False)
    created = await linking_service.propose_matches(db_session, setup["bill"].id, use_llm=True)
    assert {m.match_method for m in created} == {"text-similarity"}


@pytest.mark.asyncio
async def test_old_lexical_proposals_are_rescored_but_decisions_are_kept(db_session, monkeypatch, setup):
    first, second = setup["receipts"]
    licence, register = setup["entries"]["licence"], setup["entries"]["register"]
    old = SubmissionMatch(receipt_ref=first.id, report_entry_ref=register.id, match_method="text-similarity",
                          confidence_score=0.4, explanation="old guess", reviewer_decision="pending")
    decided = SubmissionMatch(receipt_ref=second.id, report_entry_ref=register.id, match_method="text-similarity",
                              confidence_score=0.4, explanation="confirmed", reviewer_decision="confirmed")
    db_session.add_all([old, decided])
    await db_session.commit()
    fake_gemini(monkeypatch, lambda receipts, entries: [
        {"receipt_id": str(r["id"]), "entry_id": str(licence.id), "confidence": 0.9, "explanation": "better"} for r in receipts])
    created = await linking_service.propose_matches(db_session, setup["bill"].id)
    assert [m.receipt_ref for m in created] == [first.id]  # only the pending lexical guess was rescored
    assert [m.match_method for m in await matches_for(db_session, first)] == ["llm"]
    [kept] = await matches_for(db_session, second)
    assert kept.reviewer_decision == "confirmed"


@pytest.mark.asyncio
async def test_reports_for_a_different_bill_number_are_skipped(db_session, monkeypatch, setup):
    report = setup["report"]
    report.bill_number = 99  # official reference conflicts with the bill
    await db_session.commit()
    fake_gemini(monkeypatch, lambda r, e: pytest.fail("Gemini must not see entries from a different bill"))
    assert await linking_service.propose_matches(db_session, setup["bill"].id) == []


@pytest.mark.asyncio
async def test_nothing_to_match_returns_empty(db_session, setup):
    assert await linking_service.propose_matches(db_session, uuid.uuid4()) == []  # unknown bill
    empty_bill = LegislativeItem(title="Empty Bill", identifier="NA/2026/Bill-099", institution="National Assembly",
                                 stage="First Reading", documents=[], status_history=[])
    db_session.add(empty_bill)
    await db_session.commit()
    assert await linking_service.propose_matches(db_session, empty_bill.id) == []


def test_house_names_are_compared_loosely():
    assert linking_service._house_key(None) is None
    assert linking_service._house_key(" The Senate ") == "senate"
    assert linking_service._house_key("NA") == linking_service._house_key("National Assembly of Kenya") == "na"
    assert linking_service._house_key("Nairobi City County Assembly") == "nairobi city county assembly"


@pytest.mark.asyncio
async def test_moderator_decisions_are_saved_audited_and_notified(db_session, setup):
    first, second = setup["receipts"]
    licence, register = setup["entries"]["licence"], setup["entries"]["register"]
    strong = SubmissionMatch(receipt_ref=first.id, report_entry_ref=licence.id, match_method="llm",
                             confidence_score=0.9, explanation="x", reviewer_decision="pending")
    weak_duplicate = SubmissionMatch(receipt_ref=first.id, report_entry_ref=register.id, match_method="llm",
                                     confidence_score=0.6, explanation="x", reviewer_decision="pending")
    other = SubmissionMatch(receipt_ref=second.id, report_entry_ref=register.id, match_method="llm",
                            confidence_score=0.7, explanation="x", reviewer_decision="pending")
    db_session.add_all([strong, weak_duplicate, other])
    await db_session.commit()

    pending = await linking_service.get_pending_matches(db_session)
    assert {m.id for m in pending} == {strong.id, other.id}  # one strongest proposal per receipt

    reviewer = setup["reviewer"].id
    confirmed = await linking_service.confirm_match(db_session, strong.id, reviewer)
    assert confirmed.reviewer_decision == "confirmed" and confirmed.reviewer_id == reviewer
    rejected = await linking_service.reject_match(db_session, other.id, reviewer, "Does not answer this view")
    assert rejected.reviewer_decision == "rejected" and rejected.reviewer_reason == "Does not answer this view"
    kinds = await messages_of(db_session, setup["citizen"])
    assert "match_confirmed" in kinds and "match_rejected" in kinds

    with pytest.raises(ValueError):
        await linking_service.confirm_match(db_session, uuid.uuid4(), reviewer)
    with pytest.raises(ValueError):
        await linking_service.reject_match(db_session, uuid.uuid4(), reviewer, "x")


@pytest.mark.asyncio
async def test_decision_notice_is_skipped_when_records_are_missing(db_session, setup):
    ghost = SubmissionMatch(id=uuid.uuid4(), receipt_ref=uuid.uuid4(), report_entry_ref=uuid.uuid4(),
                            match_method="llm", confidence_score=0.9, explanation="x")
    await linking_service._notify_decision(db_session, ghost, "confirmed")  # must not raise
