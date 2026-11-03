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


## Notice records and bill-text availability — 2026-10-26

- Updated the Clerk’s Office notice form to load all live bills from `GET /bills`, rather than the committee-scoped ingestion list. This includes synchronized bills and locally ingested bills.
- Added a typeable bill picker with bill title and identifier suggestions.
- Added institution options from active platform committees and live bill institutions, with server-side validation.
- Added `PUT /notices/{id}` and an Edit action that hydrates the saved bill, institution, dates, mode, and bill-text checkbox.
- Added `GET /bills/{id}/documents/{document_index}` for safe access to URL-backed or stored bill documents.
- A notice marked `bill_text_accessible=true` now exposes an **Open bill text** link to the bill Documents section. Uploaded bill PDFs with storage metadata can be opened through the API route without exposing local filesystem paths.

## Validation for this change

- `npm run typecheck` — passed.
- `npm run build` — passed; Vite reports the existing large-main-chunk warning.
- `python3 -m py_compile backend/app/api/routes.py` — passed.

## Release notes — 2026-11-03 (validated locally, not yet deployed)

**Legislation data**
- **National Assembly stages:** the Bills Tracker parser now reads "NA." / "Sen." references, which recovers 39% of rows that were being skipped. Bills get a dated stage history, official titles, "Passed by National Assembly" and other remarks, and no duplicate tracker documents.
- **County sync:** Nairobi City County Assembly and Trans Nzoia County Assembly bills, plus their Acts from Kenya Law, are synced (`app.scripts.sync_county_bills`). 28 county committees were created from each assembly's published lists.
- **Committee assignment:** official evidence first, otherwise by subject from the bill title. Administrators confirm suggestions in a new admin tab, and the sync never overrides an administrator's choice.

**Submissions**
- **Participation windows:** a call for memoranda decides; otherwise First Reading only. Assented and post-committee bills refuse submissions.
- **One submission per bill:** citizens can edit until the window closes. Edits are new append-only chain entries (`<ID>-v2`), so the receipt ID never changes.
- **Memoranda:** can be uploaded as PDF, .docx or .txt. The document's SHA-256 is part of the receipt hash.
- **Stages:** submissions move through Received, With the committee, Report published, Response under review, then the outcome. A rejected match now shows as "Not addressed in the report".

**Hash chain**
- The seed builds a real chain.
- There is a single-receipt check (`GET /receipts/{id}/verify`) shown on every receipt.
- The verification report explains why any link fails.

**Security**
- **Committee scope:** Clerk's Office accounts are limited to their own committee, both in the API and in the web client.
- **Rate limits:** a global limit, sign-in lockout, and sign-up and reset limits.
- **No anonymous jobs:** report processing moved to a background worker, so anonymous visitors can no longer trigger OCR or AI calls.
- **AI manipulation guards:** the Gemini rules sit in its system instruction; instruction-like submissions are flagged and capped, and unsupported scores are capped.

**Interface**
- **Design and homes:** Kenyan flag design system, and a home page for each role.
- **Bills pages:** a bills list with status filters and a legislature filter. The bill page has a stage tracker, a paginated submissions table and a submission dialog.
- **Submitting and receipts:** a three-step submit flow with autosave; printable receipts with a QR code, plus WhatsApp and SMS sharing.
- **Moderation:** the match review page has tabs, filters, a review panel and bulk scoring.
- **Clerk's Office:** sign-up asks for the legislature first.

**Migrations:** `20261103_submission_revisions` and `20261103_committee_source`, both adding columns only.

**Validation:** 84 backend tests passed; `npm run typecheck` and `npm run build` passed. Browser checks covered each role. Hosted services still run the previous release.
