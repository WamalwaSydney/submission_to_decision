"""Smaller services: password reset, storage, the report worker, notification drafting,
the Gemini matcher's response handling, memorandum documents, stages and committees."""
import asyncio
import io
import json
import subprocess
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, text

from app import committee_assignment, password_reset, submission_stage
from app.auth import get_password_hash
from app.models import Committee, CommitteeReport, LegislativeItem, Message, PasswordResetToken, User
from app.services import llm_matching_service, notification_service, receipt_service, report_worker, storage_service
from app.services import submission_documents as docs
from tests.test_api import TestSession, client, db_session, test_engine  # noqa: F401  (pytest fixtures)


async def make_user(db_session, **fields):
    user = User(name="Wanjiru", email=f"u-{uuid.uuid4().hex[:8]}@example.com", role="citizen",
                password_hash=get_password_hash("old-password-123"), status="active", **fields)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


# ============ Password reset ============

@pytest.mark.asyncio
async def test_reset_code_works_once_and_signs_out_other_sessions(db_session):
    user = await make_user(db_session)
    first, _ = await password_reset.issue_reset(db_session, user)
    second, expires = await password_reset.issue_reset(db_session, user)  # replaces the first code
    await db_session.commit()
    assert expires > datetime.now(timezone.utc)

    assert await password_reset.consume_reset(db_session, first, "x") is False  # superseded
    assert await password_reset.consume_reset(db_session, second, get_password_hash("new-password-123")) is True
    await db_session.commit()
    await db_session.refresh(user)
    assert user.auth_version == 1 and user.recovery_codes_generated_at is None
    assert await password_reset.consume_reset(db_session, second, "x") is False  # used
    # Only digests are stored.
    stored = (await db_session.execute(select(PasswordResetToken.token_hash))).scalars().all()
    assert second not in stored and password_reset._digest(second) in stored


@pytest.mark.asyncio
async def test_reset_refuses_expired_codes_and_suspended_accounts(db_session):
    user = await make_user(db_session)
    raw, digest, _ = password_reset.create_reset_token()
    db_session.add(PasswordResetToken(user_id=user.id, token_hash=digest, expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
    await db_session.commit()
    assert await password_reset.consume_reset(db_session, raw, "x") is False

    suspended = await make_user(db_session)
    code, _ = await password_reset.issue_reset(db_session, suspended)
    suspended.status = "suspended"
    await db_session.commit()
    assert await password_reset.consume_reset(db_session, code, "x") is False


# ============ Report storage ============

def test_reports_are_stored_once_under_a_safe_name(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_service, "STORAGE_DIR", tmp_path / "reports")
    first = storage_service.persist_report(b"%PDF report", "../../etc/My Report (final).pdf")
    again = storage_service.persist_report(b"%PDF report", "My Report (final).pdf")
    assert first["storage_ref"] == again["storage_ref"] and first["size_bytes"] == 11
    assert "/" not in first["storage_ref"].rsplit("reports/", 1)[1] and "(" not in first["storage_ref"]
    assert first["mime_type"] == "application/pdf" and len(first["sha256"]) == 64
    assert storage_service.persist_report(b"%PDF", "")["storage_ref"].endswith("report.pdf")


# ============ Report worker ============

@pytest.mark.asyncio
async def test_worker_reads_and_matches_pending_linked_reports(db_session, monkeypatch):
    monkeypatch.setattr(report_worker, "async_session", TestSession)
    bill = LegislativeItem(title="Bill", identifier="NA/2026/Bill-500", institution="National Assembly", stage="Committee Stage", documents=[], status_history=[])
    db_session.add(bill)
    await db_session.flush()
    db_session.add(CommitteeReport(bill_ref=bill.id, institution="National Assembly", date_tabled=date(2026, 1, 1),
                                   source_document_ref="r.pdf", source_url="https://www.parliament.go.ke/r.pdf", extraction_status="pending", ocr_used=False))
    await db_session.commit()
    seen = []

    async def extract(db, bill_id):
        seen.append(("extract", bill_id))

    async def propose(db, bill_id, use_llm=True):
        seen.append(("match", bill_id))
        if len(seen) > 2:
            raise RuntimeError("second bill fails")
    monkeypatch.setattr(report_worker.ingestion_service, "extract_pending_linked_reports", extract)
    monkeypatch.setattr(report_worker.linking_service, "propose_matches", propose)
    assert await report_worker.process_pending_reports() == 1
    assert seen == [("extract", bill.id), ("match", bill.id)]
    # A failing bill is logged, not raised.
    assert await report_worker.process_pending_reports() == 1


@pytest.mark.asyncio
async def test_worker_loop_keeps_running_after_errors(monkeypatch):
    calls = {"runs": 0, "sleeps": 0}

    async def run():
        calls["runs"] += 1
        if calls["runs"] == 1:
            raise RuntimeError("database briefly unavailable")
        return 2

    async def sleep(seconds):
        calls["sleeps"] += 1
        if calls["sleeps"] > 3:
            raise asyncio.CancelledError
    monkeypatch.setattr(report_worker, "process_pending_reports", run)
    monkeypatch.setattr(report_worker.asyncio, "sleep", sleep)
    with pytest.raises(asyncio.CancelledError):
        await report_worker.run_forever()
    assert calls["runs"] == 3


def test_worker_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("REPORT_WORKER_ENABLED", "false")
    assert report_worker.enabled() is False
    monkeypatch.setenv("REPORT_WORKER_ENABLED", "true")
    assert report_worker.enabled() is True


# ============ Notifications ============

def gemini_reply(payload, status=200):
    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, **kwargs):
            if isinstance(payload, Exception):
                raise payload
            return httpx.Response(status, json=payload, request=httpx.Request("POST", url))
    return Client


def gemini_text(obj):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(obj)}]}}]}


@pytest.mark.asyncio
async def test_notifications_use_gemini_wording_only_when_it_keeps_the_facts(monkeypatch):
    fallback = ("Template subject", "Template body")
    facts = {"bill_title": "The Water Bill, 2026", "treatment": "amended"}
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert await notification_service._draft("match_confirmed", "en", facts, fallback) == (*fallback, "template")

    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    good = {"subject": "Update on The Water Bill, 2026", "body": "The committee amended the clause you wrote about in The Water Bill, 2026."}
    monkeypatch.setattr(notification_service.httpx, "AsyncClient", gemini_reply(gemini_text(good)))
    subject, body, source = await notification_service._draft("match_confirmed", "en", facts, fallback)
    assert source == "gemini" and subject == good["subject"]

    # A draft that drops the outcome, the bill, or fails entirely is not used.
    for reply in (gemini_text({"subject": "Update", "body": "Something happened to a bill you follow recently."}),
                  gemini_text({"subject": "", "body": ""}), httpx.ConnectError("offline")):
        monkeypatch.setattr(notification_service.httpx, "AsyncClient", gemini_reply(reply))
        assert (await notification_service._draft("match_confirmed", "en", facts, fallback))[2] == "template"
    monkeypatch.setattr(notification_service.httpx, "AsyncClient", gemini_reply({"error": "x"}, status=500))
    assert (await notification_service._draft("match_confirmed", "en", facts, fallback))[2] == "template"


@pytest.mark.asyncio
async def test_notifications_are_idempotent_and_skip_unknown_cases(db_session):
    user = await make_user(db_session, privacy_prefs={"notification_language": "sw"})
    bill = LegislativeItem(title="Mswada wa Maji", identifier="NA/2026/Bill-501", institution="National Assembly", stage="First Reading", documents=[], status_history=[])
    db_session.add(bill)
    await db_session.commit()
    receipt = await receipt_service.create_receipt(db_session, author_id=user.id, legislative_item_id=bill.id, clause_ref=None,
                                                   submission_text="Maoni yangu", public_id="RCT-SWAHI1")
    first = await notification_service.notify_receipt_event(db_session, receipt, "k1", "submission_received")
    assert first is not None and first.language == "sw"
    assert await notification_service.notify_receipt_event(db_session, receipt, "k1", "submission_received") is None  # same event
    assert await notification_service.notify_receipt_event(db_session, receipt, "k2", "no_such_event") is None
    # A template needing a fact that is missing still produces a message.
    assert await notification_service.notify_receipt_event(db_session, receipt, "k3", "match_confirmed", {}) is not None
    count = (await db_session.execute(select(Message).where(Message.recipient_user_id == user.id))).scalars().all()
    assert len(count) == 2


@pytest.mark.asyncio
async def test_notification_for_a_receipt_without_an_author_is_skipped(db_session):
    class Orphan:
        author_id = uuid.uuid4()
    assert await notification_service.notify_receipt_event(db_session, Orphan(), "k", "submission_received") is None


# ============ Gemini matcher response handling ============

@pytest.mark.asyncio
async def test_matcher_cleans_gemini_output(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    receipts = [{"id": "r1", "clause_ref": "Clause 4", "submission_text": "Clause 4 licence fees are too high for small traders"},
                {"id": "r2", "clause_ref": None, "submission_text": "Unrelated"}]
    entries = [{"id": "e1", "clause_ref": "Clause 4", "extracted_summary": "Clause 4 licence fees for small traders reduced"}]
    reply = {"matches": [
        {"receipt_id": "r1", "entry_id": "e1", "confidence": 1.7, "explanation": "same clause"},   # clamped to 1.0
        {"receipt_id": "r1", "entry_id": "e1", "confidence": 0.9, "explanation": "duplicate"},     # one per receipt
        {"receipt_id": "r2", "entry_id": "e1", "confidence": 0.3, "explanation": "weak"},          # below 0.5
        {"receipt_id": "rX", "entry_id": "e1", "confidence": 0.9, "explanation": "unknown"},
    ]}
    monkeypatch.setattr(llm_matching_service.httpx, "AsyncClient", gemini_reply(gemini_text(reply)))
    [proposal] = await llm_matching_service.propose_matches(receipts, entries)
    assert proposal["receipt_id"] == "r1" and proposal["confidence"] == 1.0

    monkeypatch.setattr(llm_matching_service.httpx, "AsyncClient", gemini_reply({"candidates": [{"content": {"parts": []}}]}))
    assert await llm_matching_service.propose_matches(receipts, entries) == []
    assert await llm_matching_service.propose_matches([], entries) == []


@pytest.mark.asyncio
async def test_matcher_reports_gemini_errors_without_the_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "secret-123")
    monkeypatch.setattr(llm_matching_service, "RETRIES", 0)

    class TextError:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, **kwargs):
            return httpx.Response(502, text="<html>Bad gateway</html>", request=httpx.Request("POST", url))
    monkeypatch.setattr(llm_matching_service.httpx, "AsyncClient", TextError)
    with pytest.raises(RuntimeError, match=r"\(502\).*Bad gateway") as error:
        await llm_matching_service.propose_matches([{"id": "r", "submission_text": "x"}], [{"id": "e", "extracted_summary": "y"}])
    assert "secret-123" not in str(error.value)


# ============ Memorandum documents ============

def make_docx(paragraphs, *, size_override=None):
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f'<w:p><w:r><w:t>{p}</w:t></w:r></w:p>' for p in paragraphs)
    xml = f'<?xml version="1.0"?><w:document xmlns:w="{ns}"><w:body>{body}</w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    return buffer.getvalue()


@pytest.mark.parametrize("content, name, message", [
    (b"text", "memo.exe", "PDF, Word"),
    (b"", "memo.txt", "empty"),
    (b"x" * (docs.MAX_BYTES + 1), "memo.txt", "larger than 10 MB"),
    (b"not a pdf", "memo.pdf", "not a valid PDF"),
    (b"not a zip", "memo.docx", "not a valid Word"),
])
def test_bad_memoranda_are_rejected_with_a_clear_reason(content, name, message):
    with pytest.raises(docs.DocumentRejected, match=message):
        docs._validate(content, name)


def test_memorandum_text_is_read_from_word_text_and_pdf(monkeypatch, tmp_path):
    monkeypatch.setattr(docs, "SUBMISSION_DIR", tmp_path)
    word = docs.store(make_docx(["First paragraph", "Second   paragraph"]), "My memo.docx")
    assert word["text"] == "First paragraph\nSecond paragraph" and word["storage_ref"].endswith("My_memo.docx")
    assert docs.store(b"Line one\r\n\n\n\nLine two", "notes.txt")["text"] == "Line one\n\nLine two"

    monkeypatch.setattr(docs.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess([], 0, "PDF text", ""))
    assert docs.store(b"%PDF-1.7 body", "memo.pdf")["text"] == "PDF text"

    def broken(*a, **k):
        raise subprocess.TimeoutExpired("pdftotext", 60)
    monkeypatch.setattr(docs.subprocess, "run", broken)
    assert docs.extract_text(b"%PDF-1.7 body", ".pdf") == ""  # unreadable scan: kept, no text


def test_word_files_without_a_document_part_are_rejected():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("other.xml", "<x/>")
    with pytest.raises(docs.DocumentRejected, match="not a valid Word"):
        docs._docx_text(buffer.getvalue())


def test_word_zip_bombs_are_refused(monkeypatch):
    class Info:
        file_size = 41 * 1024 * 1024

    class Archive:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def getinfo(self, name):
            return Info()
    monkeypatch.setattr(docs.zipfile, "ZipFile", Archive)
    with pytest.raises(docs.DocumentRejected, match="too large"):
        docs._docx_text(b"zip")


# ============ Stages ============

def test_committee_treatments_map_to_submission_outcomes():
    assert submission_stage.treatment_stage("amended") == "amended"
    assert submission_stage.treatment_stage("rejected with reasons") == "rejected"
    assert submission_stage.treatment_stage("not addressed") == "not_addressed"
    assert submission_stage.treatment_stage("adopted") == "adopted"
    assert submission_stage.treatment_stage(None) == "adopted"


# ============ Committees ============

@pytest.mark.asyncio
async def test_county_committees_are_created_once(db_session):
    async with test_engine.begin() as conn:
        created = await committee_assignment.ensure_county_committees(conn)
    async with test_engine.begin() as conn:
        again = await committee_assignment.ensure_county_committees(conn)
    assert created > 0 and again == 0


@pytest.mark.asyncio
async def test_official_committee_reports_outrank_subject_guesses(db_session):
    finance = Committee(name="Finance and National Planning", institution="National Assembly")
    db_session.add(finance)
    await db_session.flush()
    reported = LegislativeItem(title="The Miscellaneous Bill, 2026", identifier="NA/2026/Bill-600", institution="National Assembly",
                               stage="Committee Stage", documents=[], status_history=[])
    unclear = LegislativeItem(title="The Miscellaneous Provisions Bill, 2026", identifier="NA/2026/Bill-601", institution="National Assembly",
                              stage="First Reading", documents=[], status_history=[])
    db_session.add_all([reported, unclear])
    await db_session.flush()
    db_session.add(CommitteeReport(bill_ref=reported.id, institution="National Assembly", date_tabled=date(2026, 1, 1), source_document_ref="r.pdf",
                                   extraction_status="extracted", ocr_used=False, committee_name="finance and national planning"))
    await db_session.commit()
    async with test_engine.begin() as conn:
        stats = await committee_assignment.assign_committees(conn)
    assert stats["official record"] == 1 and stats["unclear"] == 1
    async with test_engine.connect() as conn:
        row = (await conn.execute(text("SELECT committee_id, committee_assignment_source FROM legislative_items WHERE identifier='NA/2026/Bill-600'"))).first()
    assert row.committee_id == finance.id and row.committee_assignment_source == "official record"


# ============ App wiring ============

@pytest.mark.asyncio
async def test_database_sessions_are_closed_after_use():
    from app.database import get_db
    generator = get_db()
    session = await generator.__anext__()
    assert session is not None
    with pytest.raises(StopAsyncIteration):
        await generator.__anext__()


def test_app_starts_and_stops_the_report_worker(monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    started = []

    async def run_forever():
        started.append(True)
        await asyncio.sleep(3600)
    monkeypatch.setattr(main.report_worker, "enabled", lambda: True)
    monkeypatch.setattr(main.report_worker, "run_forever", run_forever)
    with TestClient(main.app) as c:
        assert c.get("/health").json()["status"] == "healthy"
    assert started == [True]
