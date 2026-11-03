# REST API Reference

Base URL: `/api/v1`. Local Docker Compose: `http://localhost:8001/api/v1`. Production: `https://submission-to-decision.onrender.com/api/v1`.

**Public** endpoints need no sign-in. All others need `Authorization: Bearer <JWT>` from `POST /auth/login`. Role names: `citizen`, `committee_officer` (Clerk's Office / committee secretariat), `reviewer` (moderator; `moderator` is an alias), `administrator`.

**Rate limits** (see `backend/app/rate_limit.py`): 100 requests per minute per client IP on every `/api/` route; sign-in locks for 15 minutes after 5 failed attempts for one email from one network, and allows 30 attempts per network per 15 minutes; sign-up and password-reset requests are limited to 10 per hour per network; citizens may create 5 receipts per hour. A limited request returns **429** with a `Retry-After` header.

**Committee scope:** a `committee_officer` can act only on bills assigned to their own committee. Uploading a report, editing a report entry, verifying a report, generating matches, reading a report's entries, and creating or editing a call for views on another committee's bill (or on a bill with no committee) returns **403**.

Errors use FastAPI's format: `{"detail": "Human-readable message"}`.

---

## Authentication and accounts

| Method and path | Access | Purpose |
|---|---|---|
| `POST /auth/login` | Public | `{email, password}` → `{access_token, token_type, user}`. 401 on wrong credentials, 403 while a Clerk's Office account awaits approval, 429 when locked. |
| `POST /auth/register` | Public | Create an account. `role` is `citizen` or `committee_officer`. A Clerk's Office request must send `committee_id` and `institution` (the legislature); the committee must belong to that legislature. Citizens get a token; Clerk's Office requests return `{status: "pending_approval"}`. Both return one-time recovery codes. |
| `GET /auth/me` | Signed in | The current user. |
| `POST /auth/recovery-codes` | Signed in | Generate a new set of recovery codes (requires the current password). |
| `POST /auth/password-reset/recovery-code` | Public | Reset a password with a recovery code. |
| `POST /auth/password-reset/complete` | Public | Complete an administrator-issued reset. |
| `GET /users` · `PUT /users/{id}` | Administrator | List users; change role, status or committee. |
| `POST /users/{id}/approve-committee-officer` | Administrator | Approve a pending Clerk's Office request, optionally changing its committee. |
| `POST /users/{id}/password-reset` | Administrator | Issue a one-time reset link. |

## Committees and committee assignment

| Method and path | Access | Purpose |
|---|---|---|
| `GET /committees` | Public | Active committees (National Assembly and county assemblies). |
| `POST /committees` | Administrator | Create a committee: `{name, institution, description?, contact_email?}`. Add `account_name`, `account_email` and `account_password` (12+ characters) to create its first Clerk's Office account at the same time. |
| `GET /committees/me/bills` | Clerk's Office | Bills assigned to the caller's committee. |
| `POST /committees/me/bills` | Clerk's Office | Ingest a bill for the caller's committee (multipart: `title`, `identifier`, `stage`, optional `source_url`, optional PDF `file`). Recorded as an official assignment. |
| `PUT /bills/{id}/committee` | Administrator | `{committee_id \| null}`. The committee must belong to the bill's legislature. Sets `committee_assignment_source = "administrator"`; the sync never overrides it. |
| `POST /bills/committee/confirm` | Administrator | `{bill_ids: [...]}` (up to 500). Accepts subject-matter suggestions as they are. |

`committee_assignment_source` on every bill is `official record` (named by Parliament or the assembly), `subject matter` (suggested from the title, awaiting confirmation), `administrator`, or `null` (no committee).

## Bills

| Method and path | Access | Purpose |
|---|---|---|
| `GET /bills` | Public | Live (non-simulated) bills. Optional `institution`, `stage`, `search`. |
| `GET /bills/{id}` | Public | One bill with `outcome_counts` per submission stage and `total_submissions`. |
| `GET /bills/{id}/flow` | Public | Timeline, committee reports, report entries and each submission's stage. Reading it never starts report processing. |
| `GET /bills/{id}/documents/{index}` | Public | Open a bill document: URL-backed documents redirect to their HTTPS source; uploaded ones are served from storage. |
| `GET /bootstrap` | Public | Everything the app shell needs in one call (bills, committees, current receipts, reports, entries, matches, notices, profiles). |

Every bill object includes `participation`, worked out by `backend/app/participation.py`:

```json
{
  "status": "open | not_yet_open | closed",
  "accepting": true,
  "reason": "The committee's call for memoranda is open until 21 November 2026.",
  "opens_on": "2026-11-01",
  "closes_on": "2026-11-21"
}
```

A published call for memoranda decides the window. Without one, a bill accepts views only at First Reading (or a committee-ingested "Introduced"/"Public participation" stage). Second Reading onwards, assent, withdrawal and lapse are closed. County bills whose stage the assembly does not publish (`Published by the assembly`) are not yet open.

`outcome_counts` keys are the submission stages: `received`, `with_committee`, `report_published`, `under_review`, `adopted`, `amended`, `rejected`, `not_addressed`.

## Receipts (submissions)

A citizen has **one submission per bill**. Edits are allowed while the bill accepts views and before a moderator decides on a match. Receipts are append-only: an edit adds a new row (`<ID>-v2`, `<ID>-v3`, …) and the citizen keeps their original receipt ID.

| Method and path | Access | Purpose |
|---|---|---|
| `POST /receipts` | Citizen | Multipart: `legislative_item_id`, optional `clause_ref`, `submission_text` and/or `document` (PDF, .docx or .txt, up to 10 MB), `show_name_publicly`. 409 if the bill is closed or the citizen already has a submission on it; 422 if neither text nor a valid document is given. |
| `PUT /receipts/{receipt_id}` | The author | Edit: same fields plus `remove_document`. Returns the same `public_id` and a new `version_id`. 409 when closed, already reviewed, or when given an earlier version's ID. |
| `GET /receipts/mine/{bill_id}` | Citizen | The caller's current submission on a bill, with `editable`. |
| `GET /receipts/my` | Signed in | The caller's current submissions. |
| `GET /receipts/{receipt_id}` | Public | Look up a receipt. The receipt ID returns the current version; `<ID>-v<n>` returns that earlier version (`superseded: true`). Includes `status` (the submission stage), `document` metadata, `hash` and `previous_hash`. |
| `GET /receipts/{receipt_id}/document` | Author or staff | The uploaded memorandum file. Its text is public; the original file is restricted because it can carry signatures and contact details. |
| `GET /receipts/verify` | Public | Verify the whole chain: `{valid, total_checked, broken_count, first_broken_index, head_hash, details[]}`. Each detail gives `content_matches`, `link_matches`, `superseded` and plain-language `problems`. |
| `GET /receipts/{receipt_id}/verify` | Public | Verify one receipt: its hash, its link to the previous receipt, and that the next receipt links back to it (`next_links_back`). |
| `GET /receipts/review-queue` | Moderator | Current submissions for triage (no author IDs). |

Create and edit responses:

```json
{
  "receipt_id": "uuid",
  "public_id": "RCT-KN8X2M",
  "version_id": "RCT-KN8X2M-v2",
  "revision": 2,
  "timestamp": "2026-11-03T10:30:00Z",
  "status": "received",
  "hash": "…",
  "previous_hash": "…",
  "match_proposals": [],
  "matching_status": "submission_triage"
}
```

## Committee reports

| Method and path | Access | Purpose |
|---|---|---|
| `POST /reports/upload` | Clerk's Office (own committee) | Multipart PDF upload (`file`, `bill_ref`, `institution`, `date_tabled`, optional `source_url`). Extraction and matching run in the background after the response. |
| `GET /reports/{id}` | Clerk's Office (own committee), moderator, administrator | Report with its entries. |
| `GET /reports/{id}/document` | Public | The report PDF (redirects to Parliament's copy when linked). |
| `PUT /reports/{id}/entries/{entry_id}` | Clerk's Office (own committee), moderator, administrator | Correct an entry's treatment (`adopted`, `amended`, `rejected with reasons` — needs a reason, `not addressed`). Citizens with a confirmed match are notified. |
| `PUT /reports/{id}/verify` | Clerk's Office (own committee), administrator | Mark the report's entries as checked. |
| `POST /reports/{bill_id}/generate-matches` | Clerk's Office (own committee), moderator, administrator | Propose matches for a bill now (idempotent). |
| `POST /reports/{id}/retry-extraction` | Moderator | Re-read a linked Parliament PDF that produced no entries. |

Reports linked by the Parliament sync are read by a background worker in the API (`backend/app/services/report_worker.py`), a few bills every 10 minutes. Page views never start this work.

## Matches

| Method and path | Access | Purpose |
|---|---|---|
| `GET /matches/pending` | Moderator | Proposals waiting for a decision. |
| `POST /matches/auto-process` | Moderator | Propose matches for every bill that has a report. |
| `POST /matches/{id}/confirm` | Moderator | Confirm: the submission takes the outcome recorded in the report entry (adopted unless the report says otherwise). |
| `POST /matches/{id}/reject` | Moderator | `{reason}` required. The submission becomes "Not addressed in the report". |
| `GET /matches/confirmed` | Public | Confirmed matches for outcome trails. |

AI proposals are capped and flagged when a submission reads like instructions to the matcher, or when the score is not supported by shared wording or clause numbers; flagged explanations start with "Warning for moderators".

## Calls for views (notices)

| Method and path | Access | Purpose |
|---|---|---|
| `GET /notices` | Public | All recorded calls for memoranda. |
| `POST /notices` · `PUT /notices/{id}` | Clerk's Office (own committee), administrator | Multipart: `bill_ref`, `institution`, `notice_date`, `window_start`, `window_end`, `mode`, `bill_text_accessible`. The window decides when the bill accepts submissions. |

## Messages, profiles, moderation and export

| Method and path | Access | Purpose |
|---|---|---|
| `GET /messages` | Citizen | Automated updates about the citizen's submissions. |
| `PUT /messages/preferences` | Citizen | `{language: "en" \| "sw"}`. |
| `PUT /messages/{id}/read` | The recipient | Mark as read. |
| `GET /profiles` · `GET /profiles/{id}` | Public | Representative profiles. |
| `POST /profiles/{id}/claim` | Clerk's Office | Claim a profile. |
| `POST /profiles/{id}/verify` | Administrator | Verify a claim. |
| `POST /reports/content` | Citizen | Report another citizen's submission (`content_type: "receipt"`, `content_id`, `reason`). |
| `GET /moderation/cases` · `PUT /moderation/cases/{id}` | Moderator | Review reported submissions (`upheld` or `dismissed`). |
| `GET /export/anonymized` | Public | Identifier-free current submissions, report entries and confirmed matches. |

## Health

`GET /health` (outside `/api/v1`) → `{"status": "healthy", "version": "1.0.0"}`.
