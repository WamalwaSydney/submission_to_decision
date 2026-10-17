# Implementation notes — 2026-10-15

## Implemented

- Added first-class `committees` with institution, description, contact, status, and linked committee accounts.
- Added administrator committee creation UI/API that provisions a committee login account.
- Added committee-only bill ingestion and a committee dashboard that lists only the signed-in committee's bills.
- Added public bill-flow endpoint and screen showing stages, reports, submission outcome status, match percentage, and stated reasons without exposing citizen account IDs.
- Added citizen-to-committee and committee-to-citizen messages, read tracking, and audit events for sends/views.
- Added optional free hosted Gemini matching using `gemini-2.5-flash-lite` with strict JSON validation. LLM results are proposal scores expressed as percentages and remain pending until moderator confirmation.
- Preserved deterministic clause/text matching when no LLM key is configured or the provider is unavailable.
- Removed the researcher role from frontend role types, seed data, navigation, and role checks. The migration converts legacy researcher users to citizens and exposes identifier-free public data export to everyone.
- Added database migration `20261015_committees_messages.py` for committee ownership, messages, indexes, and role constraint cleanup.

## Validation

- `npm run typecheck` — passed.
- `npm run build` — passed; Vite reports the existing large-main-chunk warning.
- `python3 -m pytest backend/tests/ -q` — 3 passed, 19 skipped because the PostgreSQL test database was unavailable.
- `python3 -m compileall -q backend/app backend/alembic` — passed.
- FastAPI import and required route registration — passed.

## Configuration

Set `GEMINI_API_KEY`, `GEMINI_API_BASE`, and optionally `GEMINI_MATCH_MODEL` on the backend to enable free hosted proposals. If the key is absent or the free quota is exhausted, the application remains functional using deterministic matching. AI matching is a proposal, not a guarantee of perfect correctness.

## Not claimed as complete

No real participant study, real committee-report ground-truth dataset, or production live-service smoke test was available in the archive. Evaluation CSV files remain empty templates, and PDF fixtures are synthetic regression inputs only. Populate them only with approved de-identified data before reporting precision/recall, ingestion accuracy, task-success, or SUS results.

## Automated alerts and confidence display

Matching now queues system-origin messages automatically. Citizens receive a matching alert after the comparison run and a separate final outcome alert once a moderator-confirmed report treatment is available. Duplicate alerts are suppressed per receipt and phase. Confidence is rendered as red/low below 50%, amber/moderate from 50% to 74.9%, and green/high at 75% or above across bill flow, receipt, and moderator views.
