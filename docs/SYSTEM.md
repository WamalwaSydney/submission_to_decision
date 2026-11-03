# System Architecture

## Purpose and scope

The platform traces whether citizens' public-participation submissions are heard by Kenya's legislatures. It follows a submission from the moment it is sent to the **committee's report**: the point where the legislature formally records what it heard from the public and how it treated each view. Later stages (House votes, assent) are shown as bill context, not as the outcome of a submission.

Covered legislatures: the **National Assembly** (Parliament sync), **Nairobi City County Assembly** and **Trans Nzoia County Assembly** (county sync).

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│ Web client (React + TypeScript, Vite) — Netlify                   │
│ Visitor · Citizen · Clerk's Office · Moderator · Administrator    │
│ Role-specific home pages; Clerk's Office data scoped to one       │
│ committee in AppContext                                           │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HTTPS / REST (VITE_API_URL)
┌───────────────────────────────▼──────────────────────────────────┐
│ API (FastAPI) — Render                                            │
│ Rate limits (app/rate_limit.py) · JWT + roles (app/auth.py)       │
│ Committee scope (ensure_committee_scope) · routes (api/routes.py) │
│ Background report worker (services/report_worker.py)             │
└───────────────────────────────┬──────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│ Domain services and rules                                         │
│ receipt_service — hash chain, versions, verification              │
│ participation — when a bill accepts views                          │
│ submission_stage — where a submission is in its journey           │
│ ingestion_service — PDF text, OCR fallback, report entries        │
│ linking_service + llm_matching_service — match proposals           │
│ committee_assignment — which committee handles a bill             │
│ submission_documents — uploaded memoranda                         │
│ notification_service — bilingual automated updates                │
└───────────────────────────────┬──────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│ PostgreSQL (Neon) · report and memorandum file storage            │
│ Append-only triggers on participation_receipts and audit_log      │
└──────────────────────────────────────────────────────────────────┘
```

Data comes in through two scheduled scripts: `app.scripts.sync_legislation` (Parliament Bills Tracker, legislative proposals tracker, calls for memoranda, committee reports) and `app.scripts.sync_county_bills` (county bills pages, county committees, county Acts on Kenya Law). The Parliament sync runs the county sync and committee assignment at the end.

## A submission's journey

| Stage | Shown as | Moves on when |
|---|---|---|
| `received` | Received | The bill's call for views closes |
| `with_committee` | With the committee | A committee report on the bill is uploaded or synced |
| `report_published` | Report published | The matcher proposes the report entry that answers the view |
| `under_review` | Response under review | A moderator confirms or rejects the proposal |
| `adopted` / `amended` / `rejected` | The outcome | Taken from the confirmed report entry's treatment |
| `not_addressed` | Not addressed in the report | The report entry says so, or a moderator rejects the proposal |

The stage is computed, not stored (`backend/app/submission_stage.py`, mirrored in `src/utils/submissionStage.ts`). Rejecting a proposal means the report does not answer the view; it is never shown as a committee rejection.

## When a bill accepts submissions

`backend/app/participation.py` follows National Assembly practice (Article 118, Standing Order 127): a bill is published, read a First Time and committed to a committee, which runs public participation before reporting ahead of the Second Reading.

1. A closed stage wins: Second Reading, Committee of the Whole House, Third Reading, passage, assent, withdrawal, lapse, defeat, mediation, referral to the Senate.
2. Otherwise, a recorded call for memoranda decides: open within its window, "not yet open" before it, closed after it.
3. Otherwise, a bill is open only at First Reading (or a committee-ingested "Introduced" / "Public participation" stage).
4. Legislative proposals, published bills awaiting First Reading, and county bills whose stage the assembly does not publish are "not yet open".

The API enforces this on create and edit; the UI only offers open bills.

## Receipts and the hash chain

- Each receipt's SHA-256 hash covers its content, the previous receipt's hash and, when present, the uploaded document's SHA-256. Writes are serialised with a PostgreSQL advisory lock.
- Receipts are append-only at the database level. An edit adds a new row (`<ID>-v2`) that records the original receipt ID; the citizen's receipt ID never changes, and earlier versions remain verifiable.
- `GET /receipts/verify` checks every receipt (content, link, sequence). `GET /receipts/{id}/verify` checks one, including that the next receipt still links back to it, so a deleted receipt is detected from both sides.
- Limitation: a fully privileged database operator could rebuild the entire chain. Publishing the chain head (`head_hash`) to an independent location regularly would close this; it is not yet automated.

## Matching and human review

1. Committee report PDFs are read with `pdftotext`, falling back to Tesseract OCR, and split into report entries.
2. Gemini proposes which entry answers which submission. Its instructions are in the system instruction, and submission and report text are passed as untrusted data.
3. `llm_matching_service.check_proposal` caps the score and adds a warning for moderators when a submission reads like instructions to the AI, and caps it when wording and clause numbers do not support it.
4. A moderator confirms or rejects every proposal. Nothing becomes an outcome without that decision.

Linked Parliament reports are processed by one background worker in the API (a few bills every 10 minutes). Visitors viewing a bill never trigger it.

## Committees and access

- National Assembly committees come from the Parliament sync; county committees from each assembly's published list.
- A bill's committee comes from an official source where one exists (committee chairperson as sponsor, committee report, call for memoranda, committee ingestion). Otherwise `app.committee_assignment` suggests the committee whose subject area matches the title. Administrators confirm or change suggestions on **Administration → Committee assignments**, and the sync never overrides them.
- A Clerk's Office account belongs to one committee of one legislature, chosen at sign-up and approved by an administrator. The API refuses its actions on any other committee's bills; the web client only loads that committee's bills, reports, notices, submissions and matches for it.

## Security

| Control | Implementation |
|---|---|
| Authentication | JWT with `auth_version` (tokens are invalidated on password recovery); argon2 password hashing; one-time recovery codes |
| Authorisation | `require_role` on protected routes; `ensure_committee_scope` for Clerk's Office actions |
| Rate limits | 100 requests/min per IP on `/api/`; sign-in lock after 5 failures per email and network (15 min) and 30 attempts per network; 10 sign-up or reset requests per hour per network; 5 receipts per citizen per hour |
| Expensive work | Only the background worker, moderators and committee staff can start report extraction or matching |
| AI manipulation | System instruction, flagged and capped scores, mandatory human review |
| Uploaded files | Type and size checks, Word zip-bomb guard; original memoranda visible only to the author and staff |
| Integrity | Append-only receipts and audit log; full and single-receipt chain verification |
| Scraped content | Only links on each source's own domain are accepted (the Trans Nzoia site has carried injected spam links) |

Rate-limit counters are kept in memory, which is correct for a single API instance. Move them to Redis before running several instances.

## Deployment

| Layer | Production | Local (Docker Compose) |
|---|---|---|
| Frontend | Netlify (static Vite build) | `frontend` container on port 3000 |
| API | Render (Docker, `backend/Dockerfile`) | `backend` container on port **8001** (mapped from 8000) |
| Database | Neon PostgreSQL | `postgres` container on port 5432 |

Run backend commands locally inside the container (`docker compose exec backend …`), because the database host name `postgres` only exists on the Compose network. The repository's `evaluation/` folder is mounted into the backend container for the report-parsing tests.

## Offline drafts

Drafts are kept in IndexedDB and sent when the browser comes back online. A draft the API rejects permanently (the bill has closed, or the citizen already has a submission on it) is dropped instead of blocking the queue. The submit page also keeps an automatic per-bill draft in `localStorage`.
