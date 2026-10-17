"""Evaluate predicted receipt-to-report links against a hand-labelled JSON file.

Input format:
{
  "items": [
    {"receipt_id": "RCT-1", "predicted_entry_id": "entry-1", "gold_entry_id": "entry-1"},
    {"receipt_id": "RCT-2", "predicted_entry_id": null, "gold_entry_id": "entry-2"}
  ]
}

The evaluator treats one predicted entry per receipt as the system output and
reports exact-link precision, recall, and F1. It deliberately does not infer
correctness from text similarity; the gold label must be manually reviewed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def evaluate(path: Path) -> dict[str, float | int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data.get("items", [])
    true_positives = sum(
        1 for item in items
        if item.get("predicted_entry_id") is not None
        and item.get("predicted_entry_id") == item.get("gold_entry_id")
    )
    predicted = sum(1 for item in items if item.get("predicted_entry_id") is not None)
    gold = sum(1 for item in items if item.get("gold_entry_id") is not None)
    precision = true_positives / predicted if predicted else 0.0
    recall = true_positives / gold if gold else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "items": len(items),
        "true_positives": true_positives,
        "predicted_links": predicted,
        "gold_links": gold,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python evaluation/evaluate_links.py path/to/labels.json")
    print(json.dumps(evaluate(Path(sys.argv[1])), indent=2))
