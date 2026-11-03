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

## Automated test evidence (3 November 2026)

`python -m pytest` inside the backend container: **84 passed**, 6 warnings (third-party `passlib` deprecations). The tests run against PostgreSQL with the same append-only triggers as production. These are correctness checks, not evaluation results:

- **Chain integrity:** an edited submission, a deleted receipt and a swapped document are each detected and pointed to. Earlier versions of edited submissions stay verifiable. A freshly seeded database verifies.
- **Participation rules:** assented and post-committee bills refuse submissions, an expired call for memoranda closes a bill, one submission per bill, edits keep the receipt ID.
- **Submission stages:** a test walks one submission through received → with the committee → report published → under review → amended → not addressed.
- **Access and abuse:** Clerk's Office accounts cannot read or change another committee's reports, outcomes or calls for views. Sign-in locks after 5 failures, the global limit returns 429, viewing a bill starts no report processing, and AI scores are capped for instruction-like or unsupported submissions.
- **Data sync:** live National Assembly Bills Tracker formats (`NA.` / `Sen.` references, dated history, "Passed" remarks), Nairobi and Trans Nzoia parsers (including ignoring injected spam links), Kenya Law Act matching, and committee assignment that never overrides an administrator.

Synthetic report fixtures remain regression inputs only; precision/recall, ingestion accuracy and usability results still require the approved datasets and study described above.
