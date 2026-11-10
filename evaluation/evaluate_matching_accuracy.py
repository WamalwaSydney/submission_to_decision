"""Measure how accurately the matcher links submissions to committee report entries.

Usage (inside the backend container, with GEMINI_API_KEY set):

    docker compose exec -e PYTHONPATH=/app -e EVAL_RESULTS_DIR=/tmp/eval_results backend \
        python /evaluation/evaluate_matching_accuracy.py [/evaluation/data/matching_testset.json]

For every labelled submission the script runs both matchers the platform uses,
with the same rules as production:

* Gemini (llm_matching_service.propose_matches): the main matcher.
* Text similarity (RapidFuzz token_sort_ratio, best entry if >= 0.30): the
  fallback used when Gemini is unavailable, and the baseline to beat.

Each submission is compared with every report entry for its bill, as in
production. Nothing is written to the database. Results are saved as JSON and
as a Markdown summary.

Outcome per submission:
  correct          proposed an entry that is in the gold list
  wrong_entry      proposed an entry, but not one in the gold list
  false_match      proposed an entry when the gold list is empty
  missed           proposed nothing when the gold list is not empty
  correct_no_match proposed nothing and the gold list is empty
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import httpx
from rapidfuzz import fuzz
from sqlalchemy import select

from app.database import async_session
from app.models import CommitteeReport, LegislativeItem, ReportEntry
from app.services import llm_matching_service

HERE = Path(__file__).resolve().parent
RESULTS_DIR = Path(os.getenv("EVAL_RESULTS_DIR") or HERE / "results")
BATCH_SIZE = int(os.getenv("EVAL_BATCH_SIZE", "5"))
PAUSE_SECONDS = float(os.getenv("EVAL_PAUSE_SECONDS", "4"))  # stay under free-tier request limits
TEXT_SIMILARITY_THRESHOLD = 0.30  # same as linking_service


def wilson(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% confidence interval for a proportion (Wilson score interval)."""
    if n == 0:
        return (0.0, 0.0)
    p = successes / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (round(max(0.0, centre - margin), 3), round(min(1.0, centre + margin), 3))


def outcome(predicted: str | None, gold: set[str]) -> str:
    if predicted is None:
        return "missed" if gold else "correct_no_match"
    if not gold:
        return "false_match"
    return "correct" if predicted in gold else "wrong_entry"


def metrics(rows: list[dict]) -> dict:
    counts = defaultdict(int)
    for row in rows:
        counts[row["outcome"]] += 1
    correct = counts["correct"]
    predicted = correct + counts["wrong_entry"] + counts["false_match"]
    with_gold = correct + counts["wrong_entry"] + counts["missed"]
    no_gold = counts["false_match"] + counts["correct_no_match"]
    precision = correct / predicted if predicted else 0.0
    recall = correct / with_gold if with_gold else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    overall = correct + counts["correct_no_match"]
    return {
        "n": len(rows),
        "outcomes": dict(counts),
        "precision": round(precision, 3), "precision_ci95": wilson(correct, predicted), "proposals": predicted,
        "recall": round(recall, 3), "recall_ci95": wilson(correct, with_gold), "should_match": with_gold,
        "f1": round(f1, 3),
        "no_match_accuracy": round(counts["correct_no_match"] / no_gold, 3) if no_gold else None,
        "no_match_items": no_gold,
        "overall_accuracy": round(overall / len(rows), 3) if rows else 0.0,
        "overall_accuracy_ci95": wilson(overall, len(rows)),
    }


def text_similarity(item: dict, entries: list[dict]) -> tuple[str | None, float]:
    best_id, best = None, 0.0
    for entry in entries:
        score = fuzz.token_sort_ratio(item["text"].lower(), entry["extracted_summary"].lower()) / 100.0
        if score > best:
            best_id, best = entry["id"], score
    return (best_id, best) if best >= TEXT_SIMILARITY_THRESHOLD else (None, best)


async def load_entries(identifier: str) -> tuple[str, list[dict]]:
    async with async_session() as db:
        bill = (await db.execute(select(LegislativeItem).where(LegislativeItem.identifier == identifier))).scalar_one_or_none()
        if bill is None:
            raise SystemExit(f"Bill {identifier} not found; run the legislation sync first.")
        rows = (await db.execute(
            select(ReportEntry).join(CommitteeReport, ReportEntry.report_ref == CommitteeReport.id)
            .where(CommitteeReport.bill_ref == bill.id)
        )).scalars().all()
    entries = [{"id": str(e.id), "clause_ref": e.clause_ref, "extracted_summary": re.sub(r"\s+", " ", e.extracted_summary or "")}
               for e in rows if (e.extracted_summary or "").strip()]
    return bill.title, entries


def resolve_gold(item: dict, entries: list[dict]) -> set[str]:
    resolved = set()
    for prefix in item["gold"]:
        found = [e["id"] for e in entries if e["id"].startswith(prefix)]
        if len(found) != 1:
            raise SystemExit(f"{item['id']}: gold entry {prefix!r} matches {len(found)} entries for {item['bill']}")
        resolved.add(found[0])
    return resolved


async def gemini_proposals(items: list[dict], entries: list[dict]) -> dict[str, dict]:
    proposals = {}
    for start in range(0, len(items), BATCH_SIZE):
        batch = items[start:start + BATCH_SIZE]
        receipts = [{"id": i["id"], "clause_ref": i["clause_ref"], "submission_text": i["text"]} for i in batch]
        for attempt in range(3):
            try:
                result = await llm_matching_service.propose_matches(receipts, entries)
                break
            except httpx.TransportError:  # dropped connection; the matcher itself only retries HTTP errors
                if attempt == 2:
                    raise
                await asyncio.sleep(10 * (attempt + 1))
        for p in result:
            proposals[p["receipt_id"]] = p
        await asyncio.sleep(PAUSE_SECONDS)
    return proposals


def markdown(summary: dict) -> str:
    g, t = summary["gemini"]["overall"], summary["text_similarity"]["overall"]

    def pct(x):
        return "n/a" if x is None else f"{x * 100:.0f}%"

    def ci(pair):
        return f"{pair[0] * 100:.0f}–{pair[1] * 100:.0f}%"

    lines = [
        f"# Matching accuracy — {summary['run_at'][:10]}",
        "",
        f"Model `{summary['model']}`. {summary['items']} labelled submissions across {len(summary['bills'])} bills "
        f"({summary['should_match']} should match an entry, {summary['should_not_match']} should match nothing). "
        "Each submission was compared with every report entry for its bill.",
        "",
        "| Measure | Gemini | Text similarity (baseline) |",
        "|---|---|---|",
        f"| Precision (proposals that were correct) | {pct(g['precision'])} ({ci(g['precision_ci95'])}) | {pct(t['precision'])} ({ci(t['precision_ci95'])}) |",
        f"| Recall (correct entry found) | {pct(g['recall'])} ({ci(g['recall_ci95'])}) | {pct(t['recall'])} ({ci(t['recall_ci95'])}) |",
        f"| F1 | {g['f1']:.2f} | {t['f1']:.2f} |",
        f"| Correctly proposed nothing | {pct(g['no_match_accuracy'])} | {pct(t['no_match_accuracy'])} |",
        f"| Overall accuracy | {pct(g['overall_accuracy'])} ({ci(g['overall_accuracy_ci95'])}) | {pct(t['overall_accuracy'])} ({ci(t['overall_accuracy_ci95'])}) |",
        "",
        "Brackets show 95% confidence intervals (Wilson).",
        "",
        "## By submission style (overall accuracy)",
        "",
        "| Style | n | Gemini | Text similarity |",
        "|---|---|---|---|",
    ]
    for style, gm in summary["gemini"]["by_style"].items():
        tm = summary["text_similarity"]["by_style"][style]
        lines.append(f"| {style} | {gm['n']} | {pct(gm['overall_accuracy'])} | {pct(tm['overall_accuracy'])} |")
    lines += ["", "## Gemini accuracy by confidence score", "", "| Score | Proposals | Correct |", "|---|---|---|"]
    for band in summary["gemini"]["confidence_bands"]:
        lines.append(f"| {band['band']} | {band['proposals']} | {band['correct']} ({pct(band['precision'])}) |")
    lines += ["", "## Gemini errors", ""]
    errors = [r for r in summary["rows"] if r["gemini"]["outcome"] not in ("correct", "correct_no_match")]
    if not errors:
        lines.append("None.")
    for r in errors:
        gm = r["gemini"]
        proposed = f"proposed {gm['clause']} at {gm['confidence']:.2f}" if gm["entry_id"] else "proposed nothing"
        lines.append(f"- **{r['id']}** ({r['style']}, {gm['outcome']}): {proposed}. Expected: {r['expected']}. "
                     f"Submission: \"{r['text'][:160]}\"")
    return "\n".join(lines) + "\n"


async def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "data" / "matching_testset.json"
    testset = json.loads(path.read_text(encoding="utf-8"))
    if not llm_matching_service.is_configured():
        print("GEMINI_API_KEY is not set; nothing to evaluate.")
        return 1

    by_bill = defaultdict(list)
    for item in testset["items"]:
        by_bill[item["bill"]].append(item)

    rows, bills = [], {}
    started = time.perf_counter()
    for identifier, items in by_bill.items():
        title, entries = await load_entries(identifier)
        bills[identifier] = {"title": title, "report_entries": len(entries), "submissions": len(items)}
        entries_by_id = {e["id"]: e for e in entries}
        gold = {i["id"]: resolve_gold(i, entries) for i in items}
        print(f"{identifier} ({title}): {len(items)} submissions, {len(entries)} report entries")
        proposals = await gemini_proposals(items, entries)
        for item in items:
            p = proposals.get(item["id"])
            g_entry = p["entry_id"] if p else None
            t_entry, t_score = text_similarity(item, entries)
            rows.append({
                "id": item["id"], "bill": identifier, "style": item["style"], "text": item["text"],
                "expected": ", ".join(sorted({entries_by_id[e]["clause_ref"] for e in gold[item["id"]]})) or "no match",
                "gold_entry_ids": sorted(gold[item["id"]]),
                "gemini": {
                    "entry_id": g_entry, "clause": entries_by_id[g_entry]["clause_ref"] if g_entry else None,
                    "confidence": round(p["confidence"], 3) if p else None,
                    "explanation": p["explanation"] if p else None,
                    "outcome": outcome(g_entry, gold[item["id"]]),
                },
                "text_similarity": {
                    "entry_id": t_entry, "clause": entries_by_id[t_entry]["clause_ref"] if t_entry else None,
                    "score": round(t_score, 3), "outcome": outcome(t_entry, gold[item["id"]]),
                },
            })
    elapsed = time.perf_counter() - started

    def section(method: str) -> dict:
        method_rows = [{"outcome": r[method]["outcome"], "style": r["style"]} for r in rows]
        by_style = defaultdict(list)
        for r in method_rows:
            by_style[r["style"]].append(r)
        return {"overall": metrics(method_rows), "by_style": {s: metrics(v) for s, v in by_style.items()}}

    gemini, text = section("gemini"), section("text_similarity")
    bands = []
    for low, high in ((0.5, 0.7), (0.7, 0.9), (0.9, 1.01)):
        hits = [r for r in rows if r["gemini"]["confidence"] is not None and low <= r["gemini"]["confidence"] < high]
        correct = sum(r["gemini"]["outcome"] == "correct" for r in hits)
        bands.append({"band": f"{low:.1f}–{min(high, 1.0):.1f}", "proposals": len(hits), "correct": correct,
                      "precision": round(correct / len(hits), 3) if hits else None})
    gemini["confidence_bands"] = bands

    summary = {
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": llm_matching_service.MODEL,
        "testset": str(path.name),
        "items": len(rows),
        "should_match": sum(1 for r in rows if r["gold_entry_ids"]),
        "should_not_match": sum(1 for r in rows if not r["gold_entry_ids"]),
        "batch_size": BATCH_SIZE,
        "seconds": round(elapsed, 1),
        "bills": bills,
        "gemini": gemini,
        "text_similarity": text,
        "rows": rows,
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    (RESULTS_DIR / f"matching_accuracy_{stamp}.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    (RESULTS_DIR / f"matching_accuracy_{stamp}.md").write_text(markdown(summary), encoding="utf-8")
    print(markdown(summary))
    print(f"Saved matching_accuracy_{stamp}.json and .md in {RESULTS_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
