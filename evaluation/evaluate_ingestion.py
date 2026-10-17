"""Compare extracted report fields with a manually transcribed gold CSV."""
import csv, json, sys
from pathlib import Path

def evaluate(path: Path) -> dict:
    rows = list(csv.DictReader(path.open(encoding='utf-8')))
    scored = [r for r in rows if r.get('expected_value', '').strip()]
    correct = sum(1 for r in scored if r.get('extracted_value','').strip() == r['expected_value'].strip())
    return {'rows': len(rows), 'scored_rows': len(scored), 'correct': correct,
            'field_accuracy': round(correct / len(scored), 4) if scored else None,
            'status': 'measured' if scored else 'awaiting approved gold labels'}

if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit('Usage: python evaluation/evaluate_ingestion.py path/to/gold.csv')
    print(json.dumps(evaluate(Path(sys.argv[1])), indent=2))
