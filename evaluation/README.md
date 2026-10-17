# Traceability Evaluation

The capstone evaluation should use a constrained, manually labelled dataset rather than claiming general understanding of every Kenyan committee report.

## Linking evaluation

1. Select a small set of historical or clearly simulated bills and reports.
2. Extract receipt/report-entry candidates using the application.
3. Have a reviewer label the correct report entry for each receipt, or mark it as having no explicit treatment.
4. Export predicted links as JSON using the schema shown in `labels.example.json`.
5. Run:

```bash
python evaluation/evaluate_links.py evaluation/labels.example.json
```

The script reports exact-link precision, recall, and F1. The report should also include the number of OCR pages, entries requiring correction, and false-match examples.

## Usability evaluation

Use task-based testing with citizens or representative proxy users. Suggested tasks:

- Find a bill and identify its participation deadline.
- Submit a clause-specific view.
- Retrieve the receipt using its public ID.
- Locate the committee treatment of the submitted issue.

Record task completion, time-on-task, comprehension of the platform-receipt disclaimer, and a short usability questionnaire. Obtain the required institutional ethics/data-collection approvals before recruiting real participants.

## Data handling

Use simulated or public records unless the required approvals are in place. Remove names, emails, author IDs, and other unnecessary identifiers from evaluation exports. A platform receipt is evidence of what the platform recorded; it is not an official Assembly receipt.
