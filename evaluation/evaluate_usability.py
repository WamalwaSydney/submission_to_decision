"""Summarize de-identified task success and SUS results."""
import csv, json, sys
from pathlib import Path

def evaluate(path: Path) -> dict:
    rows = list(csv.DictReader(path.open(encoding='utf-8')))
    tasks = [r for r in rows if r.get('completed','').lower() in {'true','1','yes'} or r.get('completed','').lower() in {'false','0','no'}]
    completed = sum(r.get('completed','').lower() in {'true','1','yes'} for r in tasks)
    sus = [float(r['sus_score']) for r in rows if r.get('sus_score','').strip()]
    return {'rows': len(rows), 'task_rows': len(tasks), 'completed_tasks': completed,
            'task_completion_rate': round(completed / len(tasks), 4) if tasks else None,
            'mean_sus': round(sum(sus)/len(sus), 2) if sus else None,
            'status': 'measured' if tasks and sus else 'awaiting approved participant results'}

if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit('Usage: python evaluation/evaluate_usability.py path/to/sessions.csv')
    print(json.dumps(evaluate(Path(sys.argv[1])), indent=2))
