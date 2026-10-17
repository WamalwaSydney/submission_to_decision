# Evaluation protocol and evidence status

This document prevents demo data from being reported as research evidence.

## Linking accuracy

1. Export candidate predictions from the moderator workflow.
2. Have two reviewers independently label the correct report entry (or `blank` for no valid link).
3. Resolve disagreements before creating `evaluation/data/link_labels.csv`.
4. Run:

```bash
python evaluation/evaluate_links.py evaluation/data/link_labels.json
```

Report precision, recall, F1, sample size, false-match examples, and reviewer agreement. The checked-in `labels.example.json` is illustrative only; it is not an evaluated result.

## Ingestion accuracy

Manually transcribe the expected clause reference, summary, treatment, and reason for each approved report fixture or real report. Add the extractor output in an `extracted_value` column and run:

```bash
python evaluation/evaluate_ingestion.py evaluation/data/ingestion_gold.csv
```

The committed native and scanned PDFs are synthetic regression fixtures. They must not be included as evidence of institutional reporting quality.

## Bounded usability study

Use the approved consent and ethics process before recruiting. Do not store names, phone numbers, political opinions, or unnecessary identifiers. Assign a participant code and record only county, task, completion, time, status comprehension, and SUS responses. After collection, populate `evaluation/data/usability_sessions.csv` and run:

```bash
python evaluation/evaluate_usability.py evaluation/data/usability_sessions.csv
```

The study is **not yet conducted** in this repository. Therefore no 80% task-completion or SUS ≥ 68 claim may be made yet.

## Reproducibility checklist

- Record the commit, database migration revision, fixture checksum, and evaluation script version.
- Keep real/de-identified data outside public Git until consent, retention, and access controls are approved.
- Report missing data and exclusions.
- Separate simulated, pilot, and verified institutional records in every table and chart.
