"""API workflow: committees and bills, submissions and edits, documents, committee
reports, match decisions, MP profiles, notices, moderation and the public export."""
import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.api import routes
from app.auth import create_access_token, get_password_hash
from app.models import (Committee, CommitteeReport, LegislativeItem, Message, ModerationAction, NoticeRecord,
                        ReportEntry, RepresentativeProfile, SubmissionMatch, User)
from app.services import ingestion_service, receipt_service, storage_service, submission_documents
from tests.test_api import TestSession, client, db_session  # noqa: F401  (pytest fixtures)

API = "/api/v1"


def bearer(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'ver': user.auth_version or 0})}"}


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_service, "STORAGE_DIR", tmp_path / "reports")
    monkeypatch.setattr(submission_documents, "SUBMISSION_DIR", tmp_path / "submissions")
    (tmp_path / "reports").mkdir()
    return tmp_path


async def add(db_session, *rows):
    db_session.add_all(rows)
    await db_session.commit()
    for row in rows:
        await db_session.refresh(row)
    return rows if len(rows) > 1 else rows[0]


async def person(db_session, role="citizen", **fields):
    return await add(db_session, User(name=f"{role.title()} Person", email=f"{role}-{uuid.uuid4().hex[:8]}@example.com", role=role,
                                      password_hash=get_password_hash("password123"), status="active", **fields))


def bill_row(stage="Public participation", **fields):
    return LegislativeItem(title=fields.pop("title", f"The Test Bill {uuid.uuid4().hex[:4]}, 2026"),
                           identifier=fields.pop("identifier", f"NA/2026/Bill-{uuid.uuid4().hex[:6]}"),
                           institution=fields.pop("institution", "National Assembly"), stage=stage,
                           documents=fields.pop("documents", []), status_history=[], **fields)


@pytest_asyncio.fixture
async def world(db_session):
    health = await add(db_session, Committee(name="Health", institution="National Assembly"))
    finance = await add(db_session, Committee(name="Finance", institution="National Assembly"))
    open_bill = await add(db_session, bill_row(committee_id=health.id, bill_number=7, bill_year=2026, bill_house="NA"))
    other_bill = await add(db_session, bill_row(committee_id=finance.id))
    return {
        "health": health, "finance": finance, "open_bill": open_bill, "other_bill": other_bill,
        "admin": await person(db_session, "administrator"),
        "reviewer": await person(db_session, "reviewer"),
        "clerk": await person(db_session, "committee_officer", committee_id=health.id),
        "citizen": await person(db_session),
    }


def submit(client, user, bill, text="My view on this bill", **extra):
    files = extra.pop("files", None)
    return client.post(f"{API}/receipts", headers=bearer(user), files=files,
                       data={"legislative_item_id": str(bill.id), "submission_text": text, **extra})


async def report_for(db_session, bill, entries=(), **fields):
    report = await add(db_session, CommitteeReport(bill_ref=bill.id, institution="National Assembly", date_tabled=date(2026, 3, 1),
                                                   source_document_ref=fields.pop("source_document_ref", "r.pdf"),
                                                   extraction_status=fields.pop("extraction_status", "extracted"), ocr_used=False, **fields))
    rows = [ReportEntry(report_ref=report.id, clause_ref=ref, extracted_summary=summary, treatment=treatment, stated_reason=reason)
            for ref, summary, treatment, reason in entries]
    if rows:
        await add(db_session, *rows) if len(rows) > 1 else await add(db_session, rows[0])
    return report, rows


# ============ Committees and bills ============

@pytest.mark.asyncio
async def test_committees_are_created_with_or_without_a_clerk_account(client, db_session, world):
    admin = bearer(world["admin"])

    def create(**body):
        return client.post(f"{API}/committees", headers=admin, json={"name": "Energy", "institution": "National Assembly", **body})
    assert create(account_name="Clerk").status_code == 422
    assert create(account_name="Clerk", account_email="c@example.com", account_password="short").status_code == 422
    assert create(account_name="Clerk", account_email=world["citizen"].email, account_password="long-enough-pass").status_code == 409
    assert create(name="Health").status_code == 409
    made = create(account_name="Energy Clerk", account_email="Energy@Example.com", account_password="long-enough-pass")
    assert made.status_code == 200 and made.json()["account"]["email"] == "energy@example.com"
    bare = client.post(f"{API}/committees", headers=admin, json={"name": "Lands", "institution": "National Assembly"})
    assert bare.json()["account"] is None
    names = [c["name"] for c in client.get(f"{API}/committees").json()["committees"]]
    assert {"Energy", "Lands", "Health"} <= set(names)


@pytest.mark.asyncio
async def test_clerks_ingest_bills_for_their_own_committee(client, db_session, world):
    clerk = bearer(world["clerk"])
    unlinked = await person(db_session, "committee_officer")

    def ingest(headers, files=None, **form):
        return client.post(f"{API}/committees/me/bills", headers=headers, files=files,
                           data={"title": "The Clinics Bill, 2026", "identifier": "NA/2026/Bill-777", **form})
    assert ingest(bearer(unlinked)).status_code == 409
    assert ingest(clerk, title="   ").status_code == 422
    assert ingest(clerk, files={"file": ("bill.docx", b"PK", "application/msword")}).status_code == 422
    made = ingest(clerk, files={"file": ("bill.pdf", b"%PDF-1.7 bill", "application/pdf")}, source_url=" https://www.parliament.go.ke/b.pdf ")
    assert made.status_code == 200
    bill = made.json()["bill"]
    assert bill["committee_assignment_source"] == "official record" and bill["documents"][0]["name"] == "bill.pdf"
    assert bill["source_url"] == "https://www.parliament.go.ke/b.pdf"
    assert ingest(clerk).status_code == 409  # identifier already used
    listed = client.get(f"{API}/committees/me/bills", headers=clerk).json()["bills"]
    assert {b["identifier"] for b in listed} == {world["open_bill"].identifier, "NA/2026/Bill-777"}

    # The uploaded PDF opens from the bill page.
    index = 0
    opened = client.get(f"{API}/bills/{bill['id']}/documents/{index}")
    assert opened.status_code == 200 and opened.content == b"%PDF-1.7 bill"


@pytest.mark.asyncio
async def test_bill_documents_open_safely(client, db_session, world, isolated_storage):
    (isolated_storage / "reports" / "stored.pdf").write_bytes(b"%PDF stored")
    bill = await add(db_session, bill_row(documents=[
        {"url": "https://www.parliament.go.ke/bill.pdf"},
        {"storage_ref": "../../stored.pdf", "name": "Bill.pdf"},
        "not a document",
        {"storage_ref": "missing.pdf"},
        {"url": "javascript:alert(1)"},
    ]))
    redirect = client.get(f"{API}/bills/{bill.id}/documents/0", follow_redirects=False)
    assert redirect.status_code == 307 and redirect.headers["location"] == "https://www.parliament.go.ke/bill.pdf"
    assert client.get(f"{API}/bills/{bill.id}/documents/1").content == b"%PDF stored"
    for index in (2, 3, 4, 9, -1):
        assert client.get(f"{API}/bills/{bill.id}/documents/{index}").status_code == 404
    assert client.get(f"{API}/bills/{uuid.uuid4()}/documents/0").status_code == 404


@pytest.mark.asyncio
async def test_administrators_assign_and_clear_committees(client, db_session, world):
    admin = bearer(world["admin"])
    county = await add(db_session, Committee(name="Health (Nairobi)", institution="Nairobi City County Assembly"))
    bill = world["open_bill"]
    assert client.put(f"{API}/bills/{uuid.uuid4()}/committee", headers=admin, json={"committee_id": None}).status_code == 404
    assert client.put(f"{API}/bills/{bill.id}/committee", headers=admin, json={"committee_id": str(uuid.uuid4())}).status_code == 404
    assert client.put(f"{API}/bills/{bill.id}/committee", headers=admin, json={"committee_id": str(county.id)}).status_code == 422
    cleared = client.put(f"{API}/bills/{bill.id}/committee", headers=admin, json={"committee_id": None})
    assert cleared.json()["bill"]["committee_id"] is None and cleared.json()["bill"]["committee_assignment_source"] is None
    assert client.post(f"{API}/bills/committee/confirm", headers=admin, json={"bill_ids": [str(world["other_bill"].id)]}).json() == {"confirmed": 1}


@pytest.mark.asyncio
async def test_public_bill_pages_and_flow(client, db_session, world):
    bill = world["open_bill"]
    assert client.get(f"{API}/bills/{uuid.uuid4()}").status_code == 404
    assert client.get(f"{API}/bills/{uuid.uuid4()}/flow").status_code == 404
    assert len(client.get(f"{API}/bills", params={"institution": "National Assembly", "stage": "Public participation", "search": "test bill"}).json()["bills"]) == 2

    citizens = [await person(db_session) for _ in range(3)]
    receipts = [submit(client, c, bill, text=f"View number {i}").json() for i, c in enumerate(citizens)]
    report, [entry] = await report_for(db_session, bill, [("Clause 2", "Summary", "amended", "Because")])
    decisions = ["confirmed", "pending", "rejected"]
    for receipt, decision in zip(receipts, decisions):
        await add(db_session, SubmissionMatch(receipt_ref=receipt["receipt_id"], report_entry_ref=entry.id, match_method="llm",
                                              confidence_score=0.8, explanation="x", reviewer_decision=decision,
                                              reviewer_reason="Not answered" if decision == "rejected" else None))
    page = client.get(f"{API}/bills/{bill.id}").json()
    assert page["committee"]["name"] == "Health" and page["total_submissions"] == 3
    flow = client.get(f"{API}/bills/{bill.id}/flow").json()
    by_id = {s["public_id"]: s for s in flow["submissions"]}
    assert by_id[receipts[0]["public_id"]]["reason"] == "Because" and by_id[receipts[0]["public_id"]]["match_decision"] == "confirmed"
    assert by_id[receipts[1]["public_id"]]["match_decision"] == "pending"
    assert by_id[receipts[2]["public_id"]]["reason"] == "Not answered"
    assert len(flow["report_entries"]) == 1

    boot = client.get(f"{API}/bootstrap").json()
    acknowledged = {r["public_id"]: r["lodging_status"] for r in boot["receipts"]}
    assert acknowledged[receipts[0]["public_id"]] == "acknowledged"


# ============ Messages ============

@pytest.mark.asyncio
async def test_message_preferences_and_read_rules(client, db_session, world):
    citizen, reviewer = world["citizen"], world["reviewer"]
    for method, path, body in (("put", "/messages/preferences", {"language": "sw"}), ("get", "/messages", None), ("put", "/messages/read-all", None)):
        assert getattr(client, method)(f"{API}{path}", headers=bearer(reviewer), **({"json": body} if body else {})).status_code == 403
    assert client.put(f"{API}/messages/preferences", headers=bearer(citizen), json={"language": "fr"}).status_code == 422
    assert client.put(f"{API}/messages/preferences", headers=bearer(citizen), json={"language": "sw"}).json() == {"notification_language": "sw"}

    other = await person(db_session)
    message = await add(db_session, Message(recipient_user_id=other.id, subject="s", body="b", message_type="general"))
    assert client.put(f"{API}/messages/{uuid.uuid4()}/read", headers=bearer(citizen)).status_code == 404
    assert client.put(f"{API}/messages/{message.id}/read", headers=bearer(citizen)).status_code == 403
    assert client.put(f"{API}/messages/{message.id}/read", headers=bearer(other)).json()["message"]["is_read"] is True
    assert client.put(f"{API}/messages/read-all", headers=bearer(citizen)).json() == {"marked": 0}


# ============ Submissions ============

@pytest.mark.asyncio
async def test_submission_guards(client, db_session, world):
    citizen, bill = world["citizen"], world["open_bill"]
    assert submit(client, world["reviewer"], bill).status_code == 403
    assert client.post(f"{API}/receipts", headers=bearer(citizen), data={"legislative_item_id": "not-a-uuid", "submission_text": "x"}).status_code == 404
    assert client.post(f"{API}/receipts", headers=bearer(citizen), data={"legislative_item_id": str(uuid.uuid4()), "submission_text": "x"}).status_code == 404
    assert submit(client, citizen, bill, text="   ").status_code == 422  # no text and no document
    assert submit(client, citizen, bill, text="", files={"document": ("memo.exe", b"MZ", "application/octet-stream")}).status_code == 422

    # Five submissions in an hour is the limit.
    busy = await person(db_session)
    for _ in range(5):
        other = await add(db_session, bill_row())
        await receipt_service.create_receipt(db_session, author_id=busy.id, legislative_item_id=other.id, clause_ref=None,
                                             submission_text="x", public_id=f"RCT-{uuid.uuid4().hex[:6].upper()}")
    assert submit(client, busy, bill).status_code == 429


@pytest.mark.asyncio
async def test_matching_status_explains_what_happens_next(client, db_session, world):
    async def status_for(bill):
        return submit(client, await person(db_session), bill, text="Totally unrelated words about potholes").json()["matching_status"]
    assert await status_for(world["open_bill"]) == "submission_triage"

    mismatch = await add(db_session, bill_row(bill_number=1, bill_year=2026, bill_house="Senate"))
    await report_for(db_session, mismatch, bill_number=2, bill_year=2025, bill_house="National Assembly")
    assert await status_for(mismatch) == "report_reference_mismatch"

    unread = await add(db_session, bill_row())
    await report_for(db_session, unread, extraction_status="pending")
    assert await status_for(unread) == "report_extraction_required"

    processed = await add(db_session, bill_row())
    await report_for(db_session, processed, [("Clause 1", "0000 1111 2222 3333 4444", "adopted", None)])
    assert await status_for(processed) == "already_processed"

    proposed = await add(db_session, bill_row())
    await report_for(db_session, proposed, [("Clause 1", "Totally unrelated words about potholes", "adopted", None)])
    assert await status_for(proposed) == "pending_review"


@pytest.mark.asyncio
async def test_edits_keep_documents_and_respect_review(client, db_session, world):
    citizen, bill = world["citizen"], world["open_bill"]
    created = submit(client, citizen, bill, text="", files={"document": ("memo.txt", b"Text from my memorandum", "text/plain")})
    assert created.status_code == 200
    public_id = created.json()["public_id"]

    def edit(**form):
        return client.put(f"{API}/receipts/{public_id}", headers=bearer(citizen), data=form)
    assert client.put(f"{API}/receipts/RCT-NOPE00", headers=bearer(citizen), data={"submission_text": "x"}).status_code == 404
    assert client.put(f"{API}/receipts/{public_id}", headers=bearer(await person(db_session)), data={"submission_text": "x"}).status_code == 404

    kept = edit(clause_ref="Clause 3")  # only the clause changed
    assert kept.status_code == 200 and kept.json()["receipt"]["submission_text"] == "Text from my memorandum"
    assert kept.json()["receipt"]["has_document"] is True
    assert client.put(f"{API}/receipts/{public_id}-V1", headers=bearer(citizen), data={"submission_text": "x"}).status_code == 409
    replaced = edit(submission_text="Typed instead", remove_document="true")
    assert replaced.json()["receipt"]["has_document"] is False

    # Once a moderator has decided, the submission is locked.
    _, [entry] = await report_for(db_session, bill, [("Clause 3", "Summary", "adopted", None)])
    await add(db_session, SubmissionMatch(receipt_ref=replaced.json()["receipt_id"], report_entry_ref=entry.id, match_method="llm",
                                          confidence_score=0.9, explanation="x", reviewer_decision="confirmed"))
    assert edit(submission_text="Too late").status_code == 409


@pytest.mark.asyncio
async def test_original_documents_are_only_for_the_author_and_staff(client, db_session, world, isolated_storage):
    citizen, bill = world["citizen"], world["open_bill"]
    created = submit(client, citizen, bill, text="", files={"document": ("memo.txt", b"Signed memorandum", "text/plain")}).json()
    plain = submit(client, await person(db_session), bill).json()
    path = f"{API}/receipts/{created['public_id']}/document"
    assert client.get(path, headers=bearer(citizen)).content == b"Signed memorandum"
    assert client.get(path, headers=bearer(world["reviewer"])).status_code == 200
    assert client.get(path, headers=bearer(await person(db_session))).status_code == 403
    assert client.get(f"{API}/receipts/{plain['public_id']}/document", headers=bearer(citizen)).status_code == 404
    for stored in (isolated_storage / "submissions").iterdir():
        stored.unlink()
    assert client.get(path, headers=bearer(citizen)).status_code == 404


@pytest.mark.asyncio
async def test_receipt_lookup_shows_the_committee_outcome(client, db_session, world):
    bill = world["open_bill"]
    confirmed = submit(client, await person(db_session), bill).json()
    rejected = submit(client, await person(db_session), bill).json()
    _, [entry] = await report_for(db_session, bill, [("Clause 1", "Summary", "unclassified", None)])
    await add(db_session, SubmissionMatch(receipt_ref=confirmed["receipt_id"], report_entry_ref=entry.id, match_method="llm",
                                          confidence_score=0.9, explanation="x", reviewer_decision="confirmed"))
    await add(db_session, SubmissionMatch(receipt_ref=rejected["receipt_id"], report_entry_ref=entry.id, match_method="llm",
                                          confidence_score=0.9, explanation="x", reviewer_decision="rejected", reviewer_reason="Off topic"))
    shown = client.get(f"{API}/receipts/{confirmed['public_id'].lower()}").json()
    assert shown["lodging_status"] == "acknowledged" and shown["match"]["treatment"] == "adopted"
    assert shown["match"]["decided_by"] == "committee report"
    not_addressed = client.get(f"{API}/receipts/{rejected['public_id']}").json()["match"]
    assert not_addressed["treatment"] == "not addressed" and not_addressed["stated_reason"] == "Off topic"
    assert client.get(f"{API}/receipts/RCT-NOPE00").status_code == 404
    assert client.get(f"{API}/receipts/RCT-NOPE00/verify").status_code == 404
    queue = client.get(f"{API}/receipts/review-queue", headers=bearer(world["reviewer"])).json()["receipts"]
    assert {r["public_id"] for r in queue} >= {confirmed["public_id"], rejected["public_id"]}
    assert all("author_id" not in r for r in queue)


# ============ Matches ============

@pytest.mark.asyncio
async def test_moderators_decide_matches_through_the_api(client, db_session, world):
    reviewer = bearer(world["reviewer"])
    bill = world["open_bill"]
    receipt = submit(client, world["citizen"], bill).json()
    _, [entry] = await report_for(db_session, bill, [("Clause 1", "My view on this bill", "adopted", None)])
    match = await add(db_session, SubmissionMatch(receipt_ref=receipt["receipt_id"], report_entry_ref=entry.id, match_method="llm",
                                                  confidence_score=0.9, explanation="x", reviewer_decision="pending"))
    assert [m["id"] for m in client.get(f"{API}/matches/pending", headers=reviewer).json()["matches"]] == [str(match.id)]
    assert client.post(f"{API}/matches/auto-process", headers=reviewer).json()["bills_processed"] == 1
    assert client.post(f"{API}/matches/{uuid.uuid4()}/confirm", headers=reviewer).status_code == 404
    assert client.post(f"{API}/matches/{match.id}/reject", headers=reviewer, json={"reason": "  "}).status_code == 422
    assert client.post(f"{API}/matches/{uuid.uuid4()}/reject", headers=reviewer, json={"reason": "No"}).status_code == 404
    assert client.post(f"{API}/matches/{match.id}/confirm", headers=reviewer).status_code == 200
    assert len(client.get(f"{API}/matches/confirmed").json()["matches"]) == 1

    other = submit(client, await person(db_session), bill).json()
    second = await add(db_session, SubmissionMatch(receipt_ref=other["receipt_id"], report_entry_ref=entry.id, match_method="llm",
                                                   confidence_score=0.7, explanation="x", reviewer_decision="pending"))
    assert client.post(f"{API}/matches/{second.id}/reject", headers=reviewer, json={"reason": " Does not answer it "}).json()["match"]["reviewer_reason"] == "Does not answer it"


# ============ Committee reports ============

@pytest.mark.asyncio
async def test_report_upload_checks_and_background_reading(client, db_session, world, monkeypatch):
    clerk = bearer(world["clerk"])
    bill, other = world["open_bill"], world["other_bill"]
    submit(client, world["citizen"], bill)
    processed = []

    async def process(report_id):
        processed.append(report_id)
    monkeypatch.setattr(routes, "async_session", TestSession)
    monkeypatch.setattr(ingestion_service, "process_uploaded_report", process)

    def upload(bill_ref, name="report.pdf", content=b"%PDF report", headers=clerk):
        return client.post(f"{API}/reports/upload", headers=headers, files={"file": (name, content, "application/pdf" if name.endswith(".pdf") else "text/plain")},
                           data={"bill_ref": str(bill_ref), "institution": "National Assembly", "date_tabled": "2026-03-01"})
    assert upload(bill.id, name="report.txt").status_code == 422
    assert upload("not-a-uuid").status_code == 422
    assert upload(uuid.uuid4()).status_code == 404
    assert upload(other.id).status_code == 403  # another committee's bill
    done = upload(bill.id)
    assert done.status_code == 200 and done.json()["processing"] is True
    assert processed == [uuid.UUID(str(done.json()["report_id"]))]
    async with TestSession() as fresh:
        kinds = (await fresh.execute(select(Message.message_type).where(Message.recipient_user_id == world["citizen"].id))).scalars().all()
    assert "report_received" in kinds

    # The stored PDF opens; a linked one redirects; a missing one is reported.
    report_id = done.json()["report_id"]
    assert client.get(f"{API}/reports/{report_id}/document").content == b"%PDF report"
    linked, _ = await report_for(db_session, bill, source_url="https://www.parliament.go.ke/r.pdf")
    assert client.get(f"{API}/reports/{linked.id}/document", follow_redirects=False).status_code == 307
    missing, _ = await report_for(db_session, bill, source_document_ref="gone.pdf")
    assert client.get(f"{API}/reports/{missing.id}/document").status_code == 404
    assert client.get(f"{API}/reports/{uuid.uuid4()}/document").status_code == 404


@pytest.mark.asyncio
async def test_committee_scope_blocks_unlinked_and_unassigned_work(client, db_session, world):
    unlinked = await person(db_session, "committee_officer")
    unassigned = await add(db_session, bill_row())
    report, _ = await report_for(db_session, unassigned)
    assert client.get(f"{API}/reports/{report.id}", headers=bearer(unlinked)).status_code == 403
    assert client.get(f"{API}/reports/{report.id}", headers=bearer(world["clerk"])).status_code == 403
    assert client.get(f"{API}/reports/{uuid.uuid4()}", headers=bearer(world["clerk"])).status_code == 404


@pytest.mark.asyncio
async def test_report_entries_are_corrected_and_citizens_told(client, db_session, world):
    clerk = bearer(world["clerk"])
    bill = world["open_bill"]
    receipt = submit(client, world["citizen"], bill).json()
    report, [entry] = await report_for(db_session, bill, [("Clause 1", "Summary", "unclassified", None)])
    await add(db_session, SubmissionMatch(receipt_ref=receipt["receipt_id"], report_entry_ref=entry.id, match_method="llm",
                                          confidence_score=0.9, explanation="x", reviewer_decision="confirmed"))
    path = f"{API}/reports/{report.id}/entries/{entry.id}"
    assert client.put(path, headers=clerk, json={"treatment": "vetoed"}).status_code == 422
    assert client.put(f"{API}/reports/{report.id}/entries/{uuid.uuid4()}", headers=clerk, json={"treatment": "adopted"}).status_code == 404
    assert client.put(path, headers=clerk, json={"treatment": "rejected with reasons"}).status_code == 422
    updated = client.put(path, headers=clerk, json={"treatment": "rejected with reasons", "stated_reason": "Costs too much"})
    assert updated.status_code == 200 and updated.json()["entry"]["treatment"] == "rejected with reasons"
    async with TestSession() as fresh:
        kinds = (await fresh.execute(select(Message.message_type).where(Message.recipient_user_id == world["citizen"].id))).scalars().all()
    assert "outcome_updated" in kinds

    assert client.get(f"{API}/reports/{report.id}", headers=clerk).json()["entries"][0]["stated_reason"] == "Costs too much"
    assert client.put(f"{API}/reports/{uuid.uuid4()}/verify", headers=clerk).status_code == 404
    assert client.put(f"{API}/reports/{report.id}/verify", headers=clerk).json()["report"]["extraction_status"] == "verified"
    assert client.post(f"{API}/reports/{uuid.uuid4()}/generate-matches", headers=clerk).status_code == 404
    assert client.post(f"{API}/reports/{bill.id}/generate-matches", headers=clerk).status_code == 200


@pytest.mark.asyncio
async def test_moderators_can_retry_reading_a_linked_report(client, db_session, world, monkeypatch):
    reviewer = bearer(world["reviewer"])
    bill = world["open_bill"]
    uploaded, _ = await report_for(db_session, bill, extraction_status="needs_review")
    read, _ = await report_for(db_session, bill, [("Clause 1", "Summary", "adopted", None)], source_url="https://www.parliament.go.ke/a.pdf")
    retry, _ = await report_for(db_session, bill, source_url="https://www.parliament.go.ke/b.pdf", extraction_status="needs_review")
    assert client.post(f"{API}/reports/{uuid.uuid4()}/retry-extraction", headers=reviewer).status_code == 404
    assert client.post(f"{API}/reports/{uploaded.id}/retry-extraction", headers=reviewer).status_code == 422
    assert client.post(f"{API}/reports/{read.id}/retry-extraction", headers=reviewer).status_code == 409

    async def extract(db, bill_ref=None, *, report_id=None):
        if report_id is None:  # matching also asks for pending reports by bill
            return 0
        db.add(ReportEntry(report_ref=report_id, clause_ref="Clause 9", extracted_summary="Read on retry", treatment="adopted"))
        await db.commit()
        return 1
    monkeypatch.setattr(ingestion_service, "extract_pending_linked_reports", extract)
    result = client.post(f"{API}/reports/{retry.id}/retry-extraction", headers=reviewer).json()
    assert result["reports_extracted"] == 1 and result["entries_extracted"] == 1


# ============ Profiles ============

@pytest.mark.asyncio
async def test_mp_profiles_are_claimed_then_verified(client, db_session, world):
    profile = await add(db_session, RepresentativeProfile(office="Member of Parliament", jurisdiction="Kibra", institution="National Assembly"))
    assert "user_id" not in client.get(f"{API}/profiles").json()["profiles"][0]
    assert client.get(f"{API}/profiles/{uuid.uuid4()}").status_code == 404
    assert client.get(f"{API}/profiles/{profile.id}").json()["profile"]["jurisdiction"] == "Kibra"
    assert client.post(f"{API}/profiles/{profile.id}/claim", headers=bearer(world["clerk"])).status_code == 200
    assert client.post(f"{API}/profiles/{profile.id}/claim", headers=bearer(world["clerk"])).status_code == 404
    admin = bearer(world["admin"])
    assert client.post(f"{API}/profiles/{uuid.uuid4()}/verify", headers=admin, data={"status": "verified"}).status_code == 404
    verified = client.post(f"{API}/profiles/{profile.id}/verify", headers=admin, data={"status": "verified"}).json()["profile"]
    assert verified["verification_status"] == "verified" and verified["profile_label"] == "verified"


# ============ Notices ============

@pytest.mark.asyncio
async def test_notices_are_recorded_and_corrected(client, db_session, world):
    clerk = bearer(world["clerk"])
    bill = world["open_bill"]
    submit(client, world["citizen"], bill)
    today = date.today()
    form = {"bill_ref": str(bill.id), "institution": "National Assembly", "notice_date": today.isoformat(),
            "window_start": today.isoformat(), "window_end": (today + timedelta(days=14)).isoformat(), "mode": "Newspaper"}
    for bad in ({"bill_ref": "nope"}, {"bill_ref": str(uuid.uuid4())}, {"institution": "Mars Assembly"},
                {"window_end": (today - timedelta(days=1)).isoformat()}):
        assert client.post(f"{API}/notices", headers=clerk, data={**form, **bad}).status_code == 422
    made = client.post(f"{API}/notices", headers=clerk, data={**form, "bill_text_accessible": "true"})
    assert made.status_code == 200
    notice_id = made.json()["notice"]["id"]
    async with TestSession() as fresh:
        kinds = (await fresh.execute(select(Message.message_type).where(Message.recipient_user_id == world["citizen"].id))).scalars().all()
    assert "notice_published" in kinds

    assert client.put(f"{API}/notices/{uuid.uuid4()}", headers=clerk, data=form).status_code == 404
    for bad in ({"bill_ref": "nope"}, {"bill_ref": str(uuid.uuid4())}, {"institution": "Mars Assembly"},
                {"window_end": (today - timedelta(days=1)).isoformat()}):
        assert client.put(f"{API}/notices/{notice_id}", headers=clerk, data={**form, **bad}).status_code == 422
    corrected = client.put(f"{API}/notices/{notice_id}", headers=clerk, data={**form, "mode": "Gazette notice"})
    assert corrected.json()["notice"]["mode"] == "Gazette notice"
    assert len(client.get(f"{API}/notices").json()["notices"]) == 1


# ============ Moderation ============

@pytest.mark.asyncio
async def test_citizens_report_other_citizens_submissions_once(client, db_session, world):
    author, reporter = world["citizen"], await person(db_session)
    receipt = submit(client, author, world["open_bill"]).json()
    staff_bill = await add(db_session, bill_row())
    staff_receipt = await receipt_service.create_receipt(db_session, author_id=world["reviewer"].id, legislative_item_id=staff_bill.id,
                                                         clause_ref=None, submission_text="staff", public_id="RCT-STAFF1")

    def report(user, content_id, reason="Spam", content_type="receipt"):
        return client.post(f"{API}/reports/content", headers=bearer(user), data={"content_type": content_type, "content_id": content_id, "reason": reason})
    assert report(world["reviewer"], receipt["public_id"]).status_code == 403
    assert report(reporter, receipt["public_id"], content_type="profile").status_code == 422
    assert report(reporter, "RCT-NOPE00").status_code == 404
    assert report(reporter, str(uuid.uuid4())).status_code == 404
    assert report(reporter, staff_receipt.public_id).status_code == 422
    assert report(author, receipt["public_id"]).status_code == 422
    assert report(reporter, receipt["public_id"], reason="   ").status_code == 422
    assert report(reporter, str(receipt["receipt_id"])).status_code == 200
    assert report(reporter, receipt["public_id"]).status_code == 409

    reviewer = bearer(world["reviewer"])
    [case] = client.get(f"{API}/moderation/cases", headers=reviewer).json()["cases"]
    assert client.put(f"{API}/moderation/cases/{case['id']}", headers=reviewer, data={"decision": "delete"}).status_code == 422
    assert client.put(f"{API}/moderation/cases/{uuid.uuid4()}", headers=reviewer, data={"decision": "upheld"}).status_code == 404
    assert client.put(f"{API}/moderation/cases/{case['id']}", headers=reviewer, data={"decision": "dismissed"}).status_code == 200
    assert client.put(f"{API}/moderation/cases/{case['id']}", headers=reviewer, data={"decision": "upheld"}).status_code == 409


@pytest.mark.asyncio
async def test_moderation_cases_about_report_entries_are_labelled(client, db_session, world):
    _, [entry] = await report_for(db_session, world["open_bill"], [("Clause 5", "Entry text", "adopted", None)])
    await add(db_session, ModerationAction(reporter_id=world["citizen"].id, content_type="report_entry", content_id=entry.id, reason="Misread"))
    [case] = client.get(f"{API}/moderation/cases", headers=bearer(world["reviewer"])).json()["cases"]
    assert case["content_label"] == "Clause 5" and case["content_text"] == "Entry text"


# ============ Export ============

@pytest.mark.asyncio
async def test_public_export_has_no_account_identifiers(client, db_session, world):
    submit(client, world["citizen"], world["open_bill"])
    export = client.get(f"{API}/export/anonymized").json()
    assert len(export["receipts"]) == 1
    assert "author_id" not in export["receipts"][0] and str(world["citizen"].id) not in str(export)
