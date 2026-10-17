# Bounded usability study protocol

**Status:** instrument ready; data collection not conducted in this repository.

## Participants

Recruit approximately 80 adults across Nairobi and Trans Nzoia using the approved consent and ethics process. Record county and broad demographic quotas only; do not collect names, phone numbers, political opinions, or other unnecessary identifiers.

## Tasks

1. Find a tracked bill and identify its institution and participation stage.
2. Submit a view against a bill and locate the resulting receipt by public ID.
3. Explain the receipt disclaimer and what the hash verification does and does not prove.
4. Open a bill’s outcome view and identify whether an issue was adopted, amended, rejected with reasons, or not addressed.
5. Find a notice and identify its publication date, participation window, mode, and bill-text accessibility.
6. Simulate a disconnected state, save a draft, reconnect, and confirm that the queued draft becomes a server receipt.

For each task record completion, time, errors, and whether the participant interpreted the status correctly. Use `evaluation/data/usability_sessions.csv` with a non-identifying participant code.

## SUS

Administer the standard 10-item System Usability Scale after the tasks. Score odd items as response minus 1, even items as 5 minus response, sum, and multiply by 2.5. Report participant count, mean, median, spread, missing responses, and the exact questionnaire version.

No task-completion rate or SUS threshold claim should be made until approved participant records are collected and the evaluation script produces a measured result.
