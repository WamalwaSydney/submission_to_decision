"""Free hosted LLM proposal matching through Google Gemini.

This service proposes links only. It never confirms a legislative outcome. The
caller must keep the deterministic fallback and human moderation workflow.
"""
from __future__ import annotations
import json
import os
from typing import Any
import httpx

MODEL = os.getenv("GEMINI_MATCH_MODEL", "gemini-2.5-flash-lite")
BASE_URL = os.getenv("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "matches": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {
                "receipt_id": {"type": "STRING"},
                "entry_id": {"type": "STRING"},
                "confidence": {"type": "NUMBER"},
                "explanation": {"type": "STRING"},
            },
            "required": ["receipt_id", "entry_id", "confidence", "explanation"],
        }}
    },
    "required": ["matches"],
}


def is_configured() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


async def propose_matches(receipts: list[dict[str, Any]], entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not receipts or not entries or not is_configured():
        return []
    prompt_data = {
        "receipts": [{"id": str(r["id"]), "clause": r.get("clause_ref"), "text": r.get("submission_text", "")} for r in receipts],
        "report_entries": [{"id": str(e["id"]), "clause": e.get("clause_ref"), "summary": e.get("extracted_summary", "")} for e in entries],
    }
    prompt = (
        "You are a cautious legislative traceability assistant. Match each citizen submission "
        "to at most one committee report entry only when the bill issue is materially aligned. "
        "Do not infer endorsement or invent a result. Use confidence from 0 to 1 as a proposal score. "
        "If there is no defensible match, omit the receipt. Explain the textual or clause evidence briefly.\n\n"
        + json.dumps(prompt_data, ensure_ascii=False)
    )
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
            "maxOutputTokens": 3000,
        },
    }
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(f"{BASE_URL}/models/{MODEL}:generateContent", params={"key": os.environ["GEMINI_API_KEY"]}, json=body)
        response.raise_for_status()
        payload = response.json()
    parts = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    content = next((part.get("text") for part in parts if part.get("text")), None)
    if not content:
        return []
    data = json.loads(content)
    receipt_ids = {str(r["id"]) for r in receipts}
    entry_ids = {str(e["id"]) for e in entries}
    clean = []
    used_receipts: set[str] = set()
    for item in data.get("matches", []):
        receipt_id, entry_id = str(item.get("receipt_id")), str(item.get("entry_id"))
        if receipt_id not in receipt_ids or entry_id not in entry_ids or receipt_id in used_receipts:
            continue
        confidence = max(0.0, min(1.0, float(item.get("confidence", 0))))
        if confidence < 0.50:
            continue
        used_receipts.add(receipt_id)
        clean.append({"receipt_id": receipt_id, "entry_id": entry_id, "confidence": confidence, "explanation": str(item.get("explanation", ""))[:1000]})
    return clean
