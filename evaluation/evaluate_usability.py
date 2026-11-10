"""Score the usability study from the Google Form export.

Usage:
    python evaluation/evaluate_usability.py evaluation/data/usability_sessions.csv [--answers answers.json]

Reports, for all participants:
  * task completion per task: on own / with help / not completed (facilitator ticks)
  * mean ease rating per task (1-7)
  * comprehension: T3 (what the receipt proves) and T4 ("Not addressed"), which have
    one correct answer each; T1, T4 outcome and T5 are scored only if an answer key
    is given with --answers, e.g. {"T1": "Committee review", "T4": "Amended", "T5": "14"}
  * System Usability Scale (0-100): mean, median, SD, range, share at or above 68

Data-quality checks, reported and used for a sensitivity analysis:
  * sus_pattern - the ten SUS answers repeat one pair or one value (5,1,5,1... or 3,3,3...)
  * flat_ease   - the same ease rating for all six tasks
  * timestamps  - submissions closer together than a session can take (MIN_SESSION_MINUTES)
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
from collections import Counter
from datetime import datetime
from pathlib import Path

TASKS = ["T1", "T2", "T3", "T4", "T5", "T6"]
TASK_NAMES = {
    "T1": "Find a bill and its stage",
    "T2": "Submit a view",
    "T3": "Find the receipt and say what it proves",
    "T4": "Find the committee outcome",
    "T5": "Read a notice's participation window",
    "T6": "Save a draft offline and send it on reconnect",
}
T3_CORRECT = "That the platform recorded my view, and when, and that it has not been changed since"
T4_MEANING_CORRECT = "The committee's report did not respond to the issue raised"
SUS_BENCHMARK = 68
MIN_SESSION_MINUTES = 10
ON_OWN, WITH_HELP = "Yes – on my own", "Yes – with help"


def col(row: dict, prefix: str) -> str:
    return next((v for k, v in row.items() if k.startswith(prefix)), "").strip()


def sus_answers(row: dict) -> list[int]:
    return [int(col(row, f"SUS {i}.")) for i in range(1, 11)]


def sus_score(answers: list[int]) -> float:
    return sum((a - 1) if i % 2 == 0 else (5 - a) for i, a in enumerate(answers)) * 2.5


def row_flags(row: dict) -> list[str]:
    out = []
    sus = sus_answers(row)
    if len(set(sus[0::2])) == 1 and len(set(sus[1::2])) == 1:
        out.append("sus_pattern")
    if len({col(row, f"{t}. How easy") for t in TASKS}) == 1:
        out.append("flat_ease")
    return out


def summarise(rows: list[dict], answers: dict) -> dict:
    n = len(rows)
    tasks = {}
    for t in TASKS:
        status = Counter(col(r, f"{t}. Was the task completed") for r in rows)
        own, helped = status.get(ON_OWN, 0), status.get(WITH_HELP, 0)
        ease = [int(v) for r in rows if (v := col(r, f"{t}. How easy"))]
        tasks[t] = {
            "task": TASK_NAMES[t], "on_own": own, "with_help": helped, "not_completed": n - own - helped,
            "completion_rate": round((own + helped) / n, 3) if n else None,
            "mean_ease": round(statistics.mean(ease), 2) if ease else None,
        }
    sus = [sus_score(sus_answers(r)) for r in rows]
    correct = {
        "T3_receipt": sum(col(r, "T3. Which statement") == T3_CORRECT for r in rows),
        "T4_not_addressed_meaning": sum(col(r, "T4. On this platform") == T4_MEANING_CORRECT for r in rows),
    }
    for key, prefix in (("T1", "T1. Which stage"), ("T4", "T4. What outcome"), ("T5", "T5. How many days")):
        if key in answers:
            correct[f"{key}_answer"] = sum(col(r, prefix) == str(answers[key]) for r in rows)
    return {
        "participants": n,
        "tasks": tasks,
        "mean_completion_rate": round(statistics.mean(t["completion_rate"] for t in tasks.values()), 3) if n else None,
        "correct_answers": correct,
        "sus": {
            "mean": round(statistics.mean(sus), 1) if sus else None,
            "median": round(statistics.median(sus), 1) if sus else None,
            "sd": round(statistics.stdev(sus), 1) if len(sus) > 1 else None,
            "min": min(sus, default=None), "max": max(sus, default=None),
            f"at_or_above_{SUS_BENCHMARK}": sum(s >= SUS_BENCHMARK for s in sus),
        },
    }


def evaluate(path: Path, answers: dict | None = None) -> dict:
    answers = answers or {}
    rows = [r for r in csv.DictReader(path.open(encoding="utf-8")) if col(r, "Participant code")]
    if not rows:
        return {"source": path.name, "status": "no participant responses yet"}
    code = lambda r: col(r, "Participant code")
    flags = {code(r): row_flags(r) for r in rows}
    times = sorted((datetime.strptime(col(r, "Timestamp"), "%d/%m/%Y %H:%M:%S"), code(r)) for r in rows)
    close = [f"{a[1]} -> {b[1]} ({(b[0] - a[0]).total_seconds() / 60:.1f} min)"
             for a, b in zip(times, times[1:]) if (b[0] - a[0]).total_seconds() < MIN_SESSION_MINUTES * 60]
    texts = Counter(t for r in rows for t in (col(r, "What was the most confusing"), col(r, "What would make")) if t)
    return {
        "source": path.name,
        "collected": f"{times[0][0]:%Y-%m-%d %H:%M} to {times[-1][0]:%Y-%m-%d %H:%M}",
        "profile": {
            "county": Counter(col(r, "Where do you live") for r in rows),
            "age_group": Counter(col(r, "Age group") for r in rows),
            "device": Counter(col(r, "Device used") for r in rows),
            "submitted_views_before": Counter(col(r, "Have you ever submitted") for r in rows),
        },
        "all": summarise(rows, answers),
        "excluding_flagged": summarise([r for r in rows if not flags[code(r)]], answers),
        "data_quality": {
            "flagged": {k: v for k, v in flags.items() if v},
            "submissions_closer_than_session_length": close,
            "repeated_free_text": {t: c for t, c in texts.items() if c > 1},
            "answer_spread": {
                "T1_stage": Counter(col(r, "T1. Which stage") for r in rows),
                "T4_outcome": Counter(col(r, "T4. What outcome") for r in rows),
                "T5_days": Counter(col(r, "T5. How many days") for r in rows),
            },
        },
        "comments": [{"participant": code(r), "confusing": col(r, "What was the most confusing"),
                      "more_useful": col(r, "What would make")} for r in rows],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("csv", type=Path)
    parser.add_argument("--answers", type=Path, help="JSON answer key for T1, T4 and T5")
    args = parser.parse_args()
    if args.answers and not args.answers.exists():
        parser.error(f"answer key {args.answers} not found; create it, e.g. "
                     '{"T1": "Committee review", "T4": "Amended", "T5": "14"}, or leave out --answers')
    key =json.loads(args.answers.read_text(encoding="utf-8")) if args.answers else {}
    print(json.dumps(evaluate(args.csv, key), indent=2, ensure_ascii=False, default=dict))
