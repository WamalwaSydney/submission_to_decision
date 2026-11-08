"""Citizen submission rules: participation windows, one submission per bill, edits, documents."""
import io
import uuid
import zipfile
from datetime import date, timedelta

import pytest
import pytest_asyncio

from app.models import LegislativeItem, NoticeRecord, User
from app.auth import create_access_token, get_password_hash
from app.participation import participation_window
from app.services import submission_documents
from tests.test_api import client, db_session  # noqa: F401  (pytest fixtures)


# ============ Participation window rules ============

def test_assented_and_post_committee_stages_are_closed():
    for stage in ("Assented", "Second Reading", "Committee Stage", "Third Reading", "Passed by National Assembly", "Withdrawn", "Lapsed"):
        window = participation_window(stage)
        assert window["accepting"] is False, stage
        assert window["status"] == "closed"
    assert "law" in participation_window("Assented")["reason"]


def test_bills_before_first_reading_are_not_yet_open():
    for stage in ("Legislative proposal", "Published", "Awaiting First Reading"):
        window = participation_window(stage)
        assert window["accepting"] is False
        assert window["status"] == "not_yet_open"


def test_first_reading_is_open_without_a_notice():
    window = participation_window("First Reading")
    assert window["accepting"] is True
    assert window["closes_on"] is None


def test_call_for_memoranda_window_is_authoritative():
    today = date(2026, 11, 3)
    open_notice = {"window_start": "2026-10-20", "window_end": "2026-11-10"}
    closed_notice = {"window_start": "2026-09-01", "window_end": "2026-09-21"}
    future_notice = {"window_start": "2026-11-20", "window_end": "2026-12-04"}

    assert participation_window("First Reading", [open_notice], today)["closes_on"] == "2026-11-10"
    expired = participation_window("First Reading", [closed_notice], today)
    assert expired["accepting"] is False and "21 September 2026" in expired["reason"]
    assert participation_window("First Reading", [future_notice], today)["status"] == "not_yet_open"
    # A notice never reopens a bill that has moved past public participation.
    assert participation_window("Assented", [open_notice], today)["accepting"] is False


# ============ API ============

@pytest_asyncio.fixture
async def citizen(db_session):
    user = User(name="Wanjiku", email=f"citizen-{uuid.uuid4().hex[:6]}@example.com", role="citizen",
                password_hash=get_password_hash("password123"), status="active")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def headers_for(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


async def make_bill(db_session, stage="First Reading", identifier=None):
    bill = LegislativeItem(title=f"The Test Bill ({stage}), 2026", identifier=identifier or f"NA/2026/Bill-{uuid.uuid4().hex[:6]}",
                           institution="National Assembly", stage=stage, documents=[], status_history=[])
    db_session.add(bill)
    await db_session.commit()
    await db_session.refresh(bill)
    return bill


@pytest.fixture(autouse=True)
def isolated_document_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(submission_documents, "SUBMISSION_DIR", tmp_path / "submissions")


@pytest.mark.asyncio
async def test_assented_bill_rejects_submissions(client, db_session, citizen):
    bill = await make_bill(db_session, stage="Assented")
    response = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "submission_text": "Too late",
    })
    assert response.status_code == 409
    assert "assented" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_expired_call_for_memoranda_rejects_submissions(client, db_session, citizen):
    bill = await make_bill(db_session)
    db_session.add(NoticeRecord(bill_ref=bill.id, institution="National Assembly", notice_date=date.today() - timedelta(days=30),
                                window_start=date.today() - timedelta(days=30), window_end=date.today() - timedelta(days=9), mode="Newspaper"))
    await db_session.commit()
    response = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "submission_text": "After the deadline",
    })
    assert response.status_code == 409
    bill_payload = client.get(f"/api/v1/bills/{bill.id}").json()
    assert bill_payload["participation"]["accepting"] is False


@pytest.mark.asyncio
async def test_one_submission_per_bill_and_edit_keeps_receipt_id(client, db_session, citizen):
    bill = await make_bill(db_session)
    first = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "clause_ref": "Clause 4", "submission_text": "Original view",
    })
    assert first.status_code == 200, first.text
    public_id = first.json()["public_id"]

    duplicate = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "submission_text": "Second view",
    })
    assert duplicate.status_code == 409
    assert public_id in duplicate.json()["detail"]

    edited = client.put(f"/api/v1/receipts/{public_id}", headers=headers_for(citizen), data={
        "clause_ref": "Clause 5", "submission_text": "Revised view",
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["public_id"] == public_id
    assert edited.json()["revision"] == 2

    lookup = client.get(f"/api/v1/receipts/{public_id}").json()
    assert lookup["submission_text"] == "Revised view"
    assert lookup["clause_ref"] == "Clause 5"
    old = client.get(f"/api/v1/receipts/{public_id}-v1").json()
    assert old["submission_text"] == "Original view"
    assert old["current_public_id"] == public_id

    # Only the current version is public, and the chain still verifies.
    receipts = client.get("/api/v1/bootstrap").json()["receipts"]
    assert [r["submission_text"] for r in receipts if r["legislative_item_id"] == str(bill.id)] == ["Revised view"]
    chain = client.get("/api/v1/receipts/verify").json()
    assert chain["valid"] is True and chain["total_checked"] == 2

    mine = client.get(f"/api/v1/receipts/mine/{bill.id}", headers=headers_for(citizen)).json()["receipt"]
    assert mine["public_id"] == public_id and mine["editable"] is True


@pytest.mark.asyncio
async def test_my_receipts_say_whether_each_can_still_be_edited(client, db_session, citizen):
    bill = await make_bill(db_session)
    created = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "submission_text": "My view on this bill",
    })
    assert created.status_code == 200, created.text
    listed = client.get("/api/v1/receipts/my", headers=headers_for(citizen)).json()["receipts"]
    assert [(r["editable"], r["edit_block"]) for r in listed] == [(True, None)]

    # The call for views closes: the submission stays viewable but can no longer be edited.
    bill.stage = "Second Reading"
    await db_session.commit()
    mine = client.get(f"/api/v1/receipts/mine/{bill.id}", headers=headers_for(citizen)).json()["receipt"]
    assert mine["editable"] is False and mine["edit_block"] == "closed"
    listed = client.get("/api/v1/receipts/my", headers=headers_for(citizen)).json()["receipts"]
    assert listed[0]["edit_block"] == "closed"
    refused = client.put(f"/api/v1/receipts/{mine['public_id']}", headers=headers_for(citizen), data={"submission_text": "Too late"})
    assert refused.status_code == 409


@pytest.mark.asyncio
async def test_other_citizens_cannot_edit(client, db_session, citizen):
    bill = await make_bill(db_session)
    public_id = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "submission_text": "Mine",
    }).json()["public_id"]
    other = User(name="Other", email="other@example.com", role="citizen", password_hash=get_password_hash("password123"), status="active")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)
    response = client.put(f"/api/v1/receipts/{public_id}", headers=headers_for(other), data={"submission_text": "Hijack"})
    assert response.status_code == 404


def docx_bytes(text):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", (
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>'
        ))
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_document_only_submission_uses_document_text_and_is_hashed(client, db_session, citizen):
    bill = await make_bill(db_session)
    response = client.post(
        "/api/v1/receipts", headers=headers_for(citizen),
        data={"legislative_item_id": str(bill.id)},
        files={"document": ("memorandum.docx", docx_bytes("Clause 7 should cover cooperatives."), "application/octet-stream")},
    )
    assert response.status_code == 200, response.text
    public_id = response.json()["public_id"]
    lookup = client.get(f"/api/v1/receipts/{public_id}").json()
    assert lookup["submission_text"] == "Clause 7 should cover cooperatives."
    assert lookup["document"]["name"] == "memorandum.docx"
    assert client.get("/api/v1/receipts/verify").json()["valid"] is True

    download = client.get(f"/api/v1/receipts/{public_id}/document", headers=headers_for(citizen))
    assert download.status_code == 200
    assert download.content.startswith(b"PK")


@pytest.mark.asyncio
async def test_rejects_unsupported_document_and_empty_submission(client, db_session, citizen):
    bill = await make_bill(db_session)
    bad = client.post("/api/v1/receipts", headers=headers_for(citizen), data={"legislative_item_id": str(bill.id)},
                      files={"document": ("memo.exe", b"MZ...", "application/octet-stream")})
    assert bad.status_code == 422
    empty = client.post("/api/v1/receipts", headers=headers_for(citizen), data={"legislative_item_id": str(bill.id), "submission_text": "   "})
    assert empty.status_code == 422


# ============ Hash chain integrity ============

async def _submit_three(client, db_session, citizen):
    ids = []
    for stage_index in range(3):
        bill = await make_bill(db_session)
        response = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
            "legislative_item_id": str(bill.id), "submission_text": f"View number {stage_index}",
        })
        assert response.status_code == 200, response.text
        ids.append(response.json()["public_id"])
    return ids


@pytest.mark.asyncio
async def test_chain_detects_edited_text_and_points_at_the_receipt(client, db_session, citizen):
    from sqlalchemy import text as sql
    ids = await _submit_three(client, db_session, citizen)
    assert client.get("/api/v1/receipts/verify").json()["valid"] is True

    # Someone with superuser database access switches off the protection and
    # quietly rewrites the middle submission.
    await db_session.execute(sql("ALTER TABLE participation_receipts DISABLE TRIGGER USER"))
    await db_session.execute(sql("UPDATE participation_receipts SET submission_text = 'Rewritten' WHERE public_id = :p"), {"p": ids[1]})
    await db_session.commit()

    chain = client.get("/api/v1/receipts/verify").json()
    assert chain["valid"] is False
    assert chain["broken_count"] == 1
    assert chain["details"][chain["first_broken_index"]]["receipt_id"] == ids[1]
    single = client.get(f"/api/v1/receipts/{ids[1].lower()}/verify").json()
    assert single["valid"] is False and single["content_matches"] is False
    assert client.get(f"/api/v1/receipts/{ids[2]}/verify").json()["valid"] is True


@pytest.mark.asyncio
async def test_chain_detects_a_deleted_receipt(client, db_session, citizen):
    from sqlalchemy import text as sql
    ids = await _submit_three(client, db_session, citizen)
    await db_session.execute(sql("ALTER TABLE participation_receipts DISABLE TRIGGER USER"))
    await db_session.execute(sql("ALTER TABLE audit_log DISABLE TRIGGER USER"))
    await db_session.execute(sql("DELETE FROM messages"))
    await db_session.execute(sql("DELETE FROM audit_log"))
    await db_session.execute(sql("DELETE FROM participation_receipts WHERE public_id = :p"), {"p": ids[1]})
    await db_session.commit()
    chain = client.get("/api/v1/receipts/verify").json()
    assert chain["valid"] is False
    broken = [item for item in chain["details"] if not item["valid"]]
    assert broken[0]["receipt_id"] == ids[2] and broken[0]["link_matches"] is False
    # The receipt before the gap also learns that nothing links back to it.
    assert client.get(f"/api/v1/receipts/{ids[0]}/verify").json()["next_links_back"] is False


@pytest.mark.asyncio
async def test_swapped_document_breaks_the_receipt(client, db_session, citizen):
    from sqlalchemy import text as sql
    bill = await make_bill(db_session)
    public_id = client.post(
        "/api/v1/receipts", headers=headers_for(citizen), data={"legislative_item_id": str(bill.id), "submission_text": "See memo"},
        files={"document": ("memo.txt", b"Original memorandum", "text/plain")},
    ).json()["public_id"]
    assert client.get(f"/api/v1/receipts/{public_id}/verify").json()["valid"] is True
    await db_session.execute(sql("ALTER TABLE participation_receipts DISABLE TRIGGER USER"))
    await db_session.execute(sql("UPDATE participation_receipts SET attachment_sha256 = :h WHERE public_id = :p"), {"h": "f" * 64, "p": public_id})
    await db_session.commit()
    assert client.get(f"/api/v1/receipts/{public_id}/verify").json()["valid"] is False


@pytest.mark.asyncio
async def test_earlier_versions_stay_verifiable(client, db_session, citizen):
    bill = await make_bill(db_session)
    public_id = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "submission_text": "First",
    }).json()["public_id"]
    client.put(f"/api/v1/receipts/{public_id}", headers=headers_for(citizen), data={"submission_text": "Second"})
    old = client.get(f"/api/v1/receipts/{public_id.lower()}-v1/verify").json()
    assert old["valid"] is True and old["superseded"] is True
    assert client.get(f"/api/v1/receipts/{public_id}/verify").json()["position"] == 2


@pytest.mark.asyncio
async def test_seed_builds_a_valid_chain(db_session, monkeypatch):
    import app.seed as seed
    from app.services.receipt_service import verify_chain
    from tests.test_api import TestSession, test_engine
    monkeypatch.setattr(seed, "async_session", TestSession)
    monkeypatch.setattr(seed, "engine", test_engine)
    await seed.seed()
    async with TestSession() as session:
        result = await verify_chain(session)
    assert result["total_checked"] == 5
    assert result["valid"] is True, [d["problems"] for d in result["details"]]


@pytest.mark.asyncio
async def test_submission_stages_follow_the_real_process(client, db_session, citizen):
    from app.models import CommitteeReport, ReportEntry, SubmissionMatch, ParticipationReceipt
    from sqlalchemy import select
    bill = await make_bill(db_session)
    public_id = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "submission_text": "County consultation is needed",
    }).json()["public_id"]
    stage = lambda: client.get(f"/api/v1/receipts/{public_id}").json()["status"]
    assert stage() == "received"

    bill.stage = "Second Reading"  # the call for views has closed
    await db_session.commit()
    assert stage() == "with_committee"

    report = CommitteeReport(bill_ref=bill.id, institution="National Assembly", date_tabled=date.today(), source_document_ref="r.pdf", extraction_status="extracted")
    db_session.add(report)
    await db_session.flush()
    entry = ReportEntry(report_ref=report.id, clause_ref="Clause 3", extracted_summary="County consultation", treatment="amended")
    db_session.add(entry)
    await db_session.commit()
    # The report is out but not yet linked to this view: not "awaiting committee report".
    assert stage() == "report_published"

    receipt = (await db_session.execute(select(ParticipationReceipt).where(ParticipationReceipt.public_id == public_id))).scalar_one()
    match = SubmissionMatch(receipt_ref=receipt.id, report_entry_ref=entry.id, match_method="llm", confidence_score=0.8, explanation="x")
    db_session.add(match)
    await db_session.commit()
    assert stage() == "under_review"

    match.reviewer_decision = "confirmed"
    await db_session.commit()
    assert stage() == "amended"

    match.reviewer_decision = "rejected"
    await db_session.commit()
    # A moderator rejecting the proposal means the report does not respond to the view.
    assert stage() == "not_addressed"
    counts = client.get(f"/api/v1/bills/{bill.id}").json()["outcome_counts"]
    assert counts["not_addressed"] == 1 and sum(counts.values()) == 1



@pytest.mark.asyncio
async def test_receipts_cannot_be_changed_or_deleted_in_the_database(client, db_session, citizen):
    from sqlalchemy import text as sql
    from sqlalchemy.exc import DBAPIError
    bill = await make_bill(db_session)
    auth = headers_for(citizen)  # read before the rollbacks below expire loaded objects
    public_id = client.post("/api/v1/receipts", headers=auth, data={
        "legislative_item_id": str(bill.id), "submission_text": "Original",
    }).json()["public_id"]
    for statement in ("UPDATE participation_receipts SET submission_text = 'x'", "DELETE FROM participation_receipts"):
        with pytest.raises(DBAPIError, match="append-only"):
            await db_session.execute(sql(statement))
        await db_session.rollback()
    # Editing still works, because an edit only ever adds a row.
    edited = client.put(f"/api/v1/receipts/{public_id}", headers=auth, data={"submission_text": "Changed"})
    assert edited.status_code == 200 and edited.json()["public_id"] == public_id


@pytest.mark.asyncio
async def test_updates_show_the_receipt_id_and_can_all_be_marked_read(client, db_session, citizen):
    bill = await make_bill(db_session)
    created = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "submission_text": "First version of my view",
    })
    assert created.status_code == 200, created.text
    public_id = created.json()["public_id"]
    edited = client.put(f"/api/v1/receipts/{public_id}", headers=headers_for(citizen), data={"submission_text": "Second version of my view"})
    assert edited.status_code == 200, edited.text

    messages = client.get("/api/v1/messages", headers=headers_for(citizen)).json()["messages"]
    assert messages, "submitting should send an update"
    # Updates name the receipt ID the citizen knows, even for the edited version.
    assert {m["receipt_public_id"] for m in messages} == {public_id}
    assert any(not m["is_read"] for m in messages)

    marked = client.put("/api/v1/messages/read-all", headers=headers_for(citizen))
    assert marked.status_code == 200 and marked.json()["marked"] == len([m for m in messages if not m["is_read"]])
    after = client.get("/api/v1/messages", headers=headers_for(citizen)).json()["messages"]
    assert all(m["is_read"] for m in after)


@pytest.mark.asyncio
async def test_moderation_cases_say_what_was_reported(client, db_session, citizen):
    bill = await make_bill(db_session)
    created = client.post("/api/v1/receipts", headers=headers_for(citizen), data={
        "legislative_item_id": str(bill.id), "submission_text": "A view another citizen will report",
    })
    assert created.status_code == 200, created.text
    receipt = created.json()

    other = User(name="Otieno", email=f"other-{uuid.uuid4().hex[:6]}@example.com", role="citizen",
                 password_hash=get_password_hash("password123"), status="active")
    reviewer = User(name="Moderator", email=f"mod-{uuid.uuid4().hex[:6]}@example.com", role="reviewer",
                    password_hash=get_password_hash("password123"), status="active")
    db_session.add_all([other, reviewer])
    await db_session.commit()
    reported = client.post("/api/v1/reports/content", headers=headers_for(other), data={
        "content_type": "receipt", "content_id": str(receipt["receipt_id"]), "reason": "This looks like spam",
    })
    assert reported.status_code in (200, 201), reported.text

    cases = client.get("/api/v1/moderation/cases", headers=headers_for(reviewer)).json()["cases"]
    case = next(c for c in cases if c["content_id"] == str(receipt["receipt_id"]))
    assert case["content_label"] == receipt["public_id"]
    assert case["content_text"] == "A view another citizen will report"
    assert case["bill_id"] == str(bill.id)
