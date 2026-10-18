"""Source-grounded citizen notifications with bilingual templates and AI drafting."""
from __future__ import annotations
import json
import os
from typing import Any
from uuid import UUID
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Message, ParticipationReceipt, User, LegislativeItem
from app.audit import record_audit

MODEL = os.getenv("GEMINI_NOTIFICATION_MODEL", os.getenv("GEMINI_MATCH_MODEL", "gemini-2.5-flash-lite"))
BASE_URL = os.getenv("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")

TEMPLATES: dict[str, dict[str, tuple[str, str]]] = {
    "submission_received": {
        "en": ("Submission received", "Thank you. Your view has been recorded for {bill_title}. Your receipt reference is {public_id}. We will update you when there is a meaningful change."),
        "sw": ("Maoni yamepokelewa", "Asante. Maoni yako yamehifadhiwa kuhusu {bill_title}. Nambari yako ya kumbukumbu ni {public_id}. Tutakujulisha kunapokuwa na mabadiliko muhimu."),
    },
    "report_received": {
        "en": ("Committee report received", "A committee report is now available for {bill_title}. Your submission is entering the matching and review process. No outcome has been confirmed yet."),
        "sw": ("Ripoti ya kamati imepokelewa", "Ripoti ya kamati kuhusu {bill_title} sasa inapatikana. Maoni yako yanaingia katika hatua ya kulinganishwa na kukaguliwa. Hakuna matokeo yaliyothibitishwa bado."),
    },
    "notice_published": {
        "en": ("Public participation notice published", "A public participation notice is available for {bill_title}. The participation window is {window_start} to {window_end}. Please check the official notice for details."),
        "sw": ("Tangazo la ushiriki wa umma limechapishwa", "Tangazo la ushiriki wa umma kuhusu {bill_title} linapatikana. Kipindi cha ushiriki ni kuanzia {window_start} hadi {window_end}. Tafadhali angalia tangazo rasmi kwa maelezo."),
    },
    "match_pending": {
        "en": ("Submission match awaiting review", "An automated check proposed a possible link between your submission and a committee report entry for {bill_title} ({confidence}% proposal confidence). A human reviewer must confirm it. This is not a final outcome."),
        "sw": ("Ulinganisho unasubiri kukaguliwa", "Ukaguzi wa kiotomatiki umependekeza uhusiano unaowezekana kati ya maoni yako na sehemu ya ripoti ya kamati kuhusu {bill_title} (uhakika wa pendekezo ni {confidence}%). Mkaguzi binadamu lazima athibitishe. Haya si matokeo ya mwisho."),
    },
    "no_match_yet": {
        "en": ("Matching update", "The available report for {bill_title} has been checked, but no defensible link to your submission was found at this time. This does not establish that your view was ignored, and no final outcome is assigned."),
        "sw": ("Taarifa ya ulinganisho", "Ripoti inayopatikana kuhusu {bill_title} imekaguliwa, lakini kwa sasa hakuna uhusiano wa kutosha uliopatikana kati yake na maoni yako. Hii haimaanishi kuwa maoni yako yalipuuzwa, na hakuna matokeo ya mwisho yaliyowekwa."),
    },
    "match_confirmed": {
        "en": ("Submission link confirmed", "A human reviewer confirmed a link between your submission and a committee report entry for {bill_title}. Recorded treatment: {treatment}. {reason} This update reflects the published record; it is not an AI judgment about your view."),
        "sw": ("Uhusiano wa maoni umethibitishwa", "Mkaguzi binadamu amethibitisha uhusiano kati ya maoni yako na sehemu ya ripoti ya kamati kuhusu {bill_title}. Ushughulikiaji uliorekodiwa: {treatment}. {reason} Taarifa hii inaakisi rekodi iliyochapishwa; si hukumu ya AI kuhusu maoni yako."),
    },
    "match_rejected": {
        "en": ("Match review completed", "A human reviewer did not confirm the proposed link between your submission and the report for {bill_title}. The proposal is not treated as a confirmed outcome. The record may change if new evidence is added."),
        "sw": ("Ukaguzi wa ulinganisho umekamilika", "Mkaguzi binadamu hakuthibitisha uhusiano uliopendekezwa kati ya maoni yako na ripoti kuhusu {bill_title}. Pendekezo hili halitachukuliwa kama matokeo yaliyothibitishwa. Rekodi inaweza kubadilika ushahidi mpya ukiongezwa."),
    },
    "outcome_updated": {
        "en": ("Recorded outcome updated", "The published committee record for {bill_title} has been updated. The human-confirmed treatment linked to your submission is now: {treatment}. {reason}"),
        "sw": ("Matokeo yaliyorekodiwa yamesasishwa", "Rekodi iliyochapishwa ya kamati kuhusu {bill_title} imesasishwa. Ushughulikiaji uliothibitishwa na binadamu unaohusishwa na maoni yako sasa ni: {treatment}. {reason}"),
    },
}


def _clean(value: Any, limit: int = 700) -> str:
    return " ".join(str(value or "").split())[:limit]

async def _draft(event_type: str, language: str, facts: dict[str, Any], fallback: tuple[str, str]) -> tuple[str, str, str]:
    """Use Gemini only to phrase supplied facts; otherwise return the built-in bilingual fallback."""
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return fallback[0], fallback[1], "template"
    prompt = (
        "Write one short, polite in-app notification in the requested language. Return strict JSON with subject and body. "
        "Use ONLY the supplied facts. Do not infer motives, merits, legal conclusions, or unrecorded committee decisions. "
        "Preserve the status/outcome exactly. If a reason is empty, do not invent one. Do not include private submission text.\n"
        f"Language: {'Kiswahili' if language == 'sw' else 'English'}\nEvent: {event_type}\nFacts: {json.dumps(facts, ensure_ascii=False)}\n"
        'Schema: {"subject":"...","body":"..."}'
    )
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json", "maxOutputTokens": 500}}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(f"{BASE_URL}/models/{MODEL}:generateContent", params={"key": key}, json=body)
            response.raise_for_status()
            payload = response.json()
        parts = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        raw = next((part.get("text") for part in parts if part.get("text")), None)
        data = json.loads(raw or "{}")
        subject, text = _clean(data.get("subject"), 180), _clean(data.get("body"), 1600)
        # Require a draft that at least names the actual bill and event-specific factual token.
        required = [str(facts.get("bill_title", ""))]
        if facts.get("treatment"):
            required.append(str(facts["treatment"]))
        if not subject or len(text) < 25 or any(token and token.casefold() not in (subject + " " + text).casefold() for token in required):
            return fallback[0], fallback[1], "template"
        return subject, text, "gemini"
    except Exception:
        return fallback[0], fallback[1], "template"

async def notify_receipt_event(
    db: AsyncSession,
    receipt: ParticipationReceipt,
    event_key: str,
    event_type: str,
    facts: dict[str, Any] | None = None,
) -> Message | None:
    if event_type not in TEMPLATES:
        return None
    already = await db.execute(select(Message.id).where(Message.event_key == event_key))
    if already.scalar_one_or_none():
        return None
    user_result = await db.execute(select(User).where(User.id == receipt.author_id))
    user = user_result.scalar_one_or_none()
    if not user:
        return None
    language = (user.privacy_prefs or {}).get("notification_language", "en")
    language = "sw" if language == "sw" else "en"
    bill_result = await db.execute(select(LegislativeItem.title).where(LegislativeItem.id == receipt.legislative_item_id))
    bill_title = bill_result.scalar_one_or_none() or "the tracked bill"
    payload = {"bill_title": _clean(bill_title), "public_id": _clean(receipt.public_id), **(facts or {})}
    payload["bill_title"] = _clean(bill_title)
    template = TEMPLATES[event_type][language]
    try:
        fallback = (template[0].format(**payload), template[1].format(**payload))
    except (KeyError, ValueError):
        fallback = (template[0], template[1])
    subject, text, source = await _draft(event_type, language, payload, fallback)
    snapshot = {
        **payload,
        "source_refs": {
            "bill_id": str(receipt.legislative_item_id),
            "receipt_id": str(receipt.id),
        },
    }
    msg = Message(
        sender_id=None, recipient_user_id=user.id, bill_id=receipt.legislative_item_id,
        receipt_id=receipt.id, subject=subject, body=text, message_type=event_type,
        sender_type="system", event_key=event_key, language=language,
        generation_source=source, source_snapshot=snapshot, delivery_status="delivered",
    )
    db.add(msg)
    await db.flush()
    await record_audit(db, entity_type="message", entity_id=msg.id, action="notification_created", actor_id=None,
                       details={"event_key": event_key, "event_type": event_type, "language": language, "generation_source": source, "receipt_id": str(receipt.id)})
    await db.commit()
    return msg
