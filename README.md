# Submission-to-Decision Traceability Platform — Kenya

Participation Trace helps citizens follow their public-participation submissions on bills in Kenya's National Assembly and county assemblies, from the moment they send a view to the committee's recorded response.

> **Status (14 November 2026):** the live site and API run the latest code, and the production database holds the full trace: committee reports, the analysis of each submission, House decisions and final Acts. Locally, 248 backend tests pass with 87% line coverage, and the type check and production build pass. See [Testing](#testing) and [Deploying this release](#deploying-this-release).

## Project links

- **GitHub repository:** https://github.com/WamalwaSydney/submission_to_decision.git
- **Figma prototype:** [Participation Trace — Kenya](https://www.figma.com/design/0xIxRyyV8vdUSg8vsUHtxx/Participation-Trace-%E2%80%94-Kenya?node-id=0-1&t=iD8kLK1UBjEuoB1B-1)
- **Video demonstration (5–10 minutes):** [_Video Link._](https://youtu.be/6kwjzjb825I)
- **Technical report (PDF, 3 pages):**  ([Google Drive](https://drive.google.com/file/d/1q9JY7gkEAiBDc2BhVNsxL6lmVeTWuHaA/view?usp=sharing))
- **Live application (Netlify):** https://participationtrace.netlify.app
- **API health check (Render):** https://submission-to-decision.onrender.com/health

## What the platform does

Public participation can feel one-way: people rarely learn whether their views were recorded or what happened to them. Participation Trace:

1. lists bills from the **National Assembly**, **Nairobi City County Assembly** and **Trans Nzoia County Assembly**, with each bill's stage and whether its committee is taking public views;
2. lets a citizen send **one view per bill** — typed, or uploaded as a memorandum — and edit it until the call for views closes;
3. issues a **tamper-evident, hash-chained receipt** that anyone can verify;
4. reads the **committee report** when it is tabled and proposes which part of it answers each view;
5. has a **moderator confirm or reject** every proposal, so no outcome is shown without a human decision;
6. shows each submission's stage in plain language: **Received → With the committee → Report published → Response under review → Adopted / Amended / Rejected with reasons / Not addressed in the report**.
7. uses **Gemini to read each committee report** and show, for every bill, how many public submissions the report records and whether the committee adopted, changed or rejected each one. The **Has submissions** filter on the Bills page lists every bill with submissions; open one to see who said what and how the committee treated it. It is labelled as an AI reading of the report, not an official record, and never changes a citizen's outcome (`python -m app.scripts.analyse_reports --passed`).

Only bills at the "Public participation" stage accept submissions. The sync puts a Parliament bill at that stage while its committee's call for memoranda is open. When the call closes, the bill goes back to its official tracker stage, or to "Public participation closed". A clerk recording a call for views on the platform moves the bill's stage the same way. A bill at First Reading with no open call waits for one.

On a bill's page, "Where the submissions are" and the submissions table trace every submission: those sent on the platform, and those the committee report records (memoranda and oral submissions, read from the report by Gemini). For each one it shows who made it, what they asked for, and whether the committee adopted, amended or rejected it, or did not respond.

Committee reports reach their bill by the official reference ("NA Bill No. 15 of 2026", "Senate No. 30 of 2024") or by the bill's exact name and year as the report title writes it. Near matches wait for a person. Bill texts come from Parliament's Bills pages and, for bills those pages miss, from Mzalendo's bill tracker, which links Parliament's PDF. `python -m app.scripts.fill_gaps` links waiting reports, adds missing bill texts and reads the newly linked reports. Add `--part 0/4` (then `1/4`, and so on) to read reports in parallel.

For passed bills, the trace continues through the House. `python -m app.scripts.trace_house --passed` finds each bill's Committee of the Whole House debate in Mzalendo's copy of the Hansard. It uses the stage dates from Parliament's Bills Tracker and matches the bill by its official number. Gemini then matches each recommendation the committee adopted to the House's decision: agreed, passed unchanged, negatived, withdrawn or no amendment. A decision is shown only when the cited Hansard lines record it, on the right clause, and an independent second check agrees the amendment carries out the recommendation.

For assented bills, the trace continues into the law. `python -m app.scripts.trace_acts --find` links each bill to its Act on Kenya Law. Staff then upload the Act PDF on the bill page, or load a folder with `--dir`. Kenya Law blocks automated downloads, so Act texts are never scraped. Gemini checks each recommendation the committee adopted against the Act. A recommendation counts as **in the final Act** only if Gemini's quoted wording is really in the Act and was not already in the bill as published. Otherwise it shows as "could not confirm".

**Scope:** the trace follows a view from its receipt to the committee report, then to the House's decision and the final Act. A platform receipt proves what this platform recorded and when; it does not prove the view reached the committee. AI readings of reports, debates and Acts are labelled as such and checked against the source text, but no person signs them off. This is an independent pilot, not an official legislative record, and not legal advice.

## Roles

| Role | Can do |
|---|---|
| Visitor | Browse bills and calls for views, track and verify any receipt |
| Citizen | Submit, edit and track their own views; receive bilingual updates |
| Clerk's Office / Committee secretariat (`committee_officer`) | For **their own committee only**: ingest bills, publish calls for views, upload and verify committee reports. Chooses legislature and committee at sign-up; an administrator approves the account. |
| Moderator (`reviewer`) | Review proposed matches (Awaiting action, Triage, Completed) and reported submissions |
| Administrator | Approve accounts, manage committees, confirm committee assignments, export data |

Each role gets its own home page with the actions it needs.

## Where the data comes from

| Data | Source | Script |
|---|---|---|
| National Assembly bills, stages and dated history | Parliament's official Bills Tracker and legislative proposals tracker (PDFs) | `backend/app/scripts/sync_legislation.py` |
| Calls for memoranda, committee reports | Parliament website | same |
| Nairobi and Trans Nzoia bills | Each assembly's bills page | `backend/app/scripts/sync_county_bills.py` |
| County Acts (bills that became law) | Nairobi's own Acts page (PDF and date of assent) and Kenya Law county legislation pages | same |
| County committee reports on bills | Nairobi's papers-laid page (scanned PDFs, read with OCR) | same |
| County committees | Each assembly's published committee list | `backend/app/committee_assignment.py` |
| Which committee handles a bill | Official evidence; otherwise suggested from the bill's subject and confirmed by an administrator | same |

Neither county assembly publishes a bill's current stage online, so county bills show **"Published by the assembly"** until a Clerk's Office account records the stage or the bill appears as an Act. An Act matches the bill of the same name and year, or the one bill of that name from up to three years earlier (never for yearly laws such as Finance or Appropriation); an Act already stored under another spelling of its name gets the new PDF rather than a second record. Nairobi committee reports link to their bill by assembly bill number, or by the bill's exact name and year; they are then read with `fill_gaps` and analysed with `analyse_reports --bill …`. Trans Nzoia publishes no committee reports on bills. The Parliament sync runs the county sync and committee assignment at the end. Seed data (`python -m app.seed`) is simulated and kept separate from synced bills.

## Technology

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Material UI, Tailwind CSS v4 (Kenyan flag palette) |
| Backend | FastAPI (Python 3.11), SQLAlchemy 2 (async), Alembic |
| Database | PostgreSQL 15 (Neon in production) with append-only triggers on receipts and the audit log |
| Integrity | SHA-256 hash chain with full and single-receipt verification |
| Reports | `pdftotext`, Tesseract OCR fallback |
| Matching | Gemini proposals with manipulation guards; mandatory human review |
| Security | JWT, argon2, recovery codes, role and committee scope checks, in-memory rate limits |
| Hosting | Netlify (frontend), Render (API, Docker), Neon (database) |

More detail: [docs/SYSTEM.md](docs/SYSTEM.md) (architecture and rules), [docs/API.md](docs/API.md), [docs/DB.md](docs/DB.md), [docs/EVALUATION.md](docs/EVALUATION.md).

## Technical requirements

| Requirement | Version used and tested |
|---|---|
| Operating system | Windows 11 (development); Linux containers in Docker and in production |
| Docker | Docker 29.6 with Compose v2 (5.1). This is the simplest way to run everything. |
| Node.js and npm | Node.js 20 (20.20), npm 10, for the frontend |
| Python | 3.11 (the backend image is `python:3.11-slim`) |
| PostgreSQL | 15 (`postgres:15-alpine` locally, Neon in production) |
| PDF and OCR tools | `poppler-utils` (`pdftotext`, `pdftoppm`) and `tesseract-ocr`, both installed in the backend image |
| Frontend libraries | React 18.2, TypeScript 5.7, Vite 6.3, Material UI 9.4, Tailwind CSS 4.1, React Router 6 |
| Backend libraries | FastAPI 0.104, SQLAlchemy 2 (async) with asyncpg 0.29, Alembic 1.13, Pydantic 2, pytest 7.4 (see `backend/requirements.txt`) |
| Optional | A Gemini API key (`GEMINI_API_KEY`) for the AI steps; Typst 0.14 to rebuild the technical report |
| Hardware | Developed on an Intel Core i5-13420H with 16 GB RAM. The stack at rest uses about 200 MB (API) and 120 MB (database); allow 8 GB RAM and 5 GB of disk for Docker images and data. OCR of large scanned reports is CPU-heavy. |
| Browsers | Tested in Chrome 157 and Edge 157 on Windows 11, and in Chrome on Android |

## Running locally

### Full stack with Docker Compose

```bash
docker compose up -d --build
```

| Service | Address |
|---|---|
| Frontend | http://localhost:3000 |
| API | http://localhost:8001/api/v1 (the container's port 8000 is mapped to 8001) |
| PostgreSQL | localhost:5432 inside Docker as host `postgres` |

Run backend commands **inside the backend container**. The database host name `postgres` only exists on the Compose network, and a PostgreSQL server installed on Windows can take port 5432 on `localhost`:

```bash
docker compose exec backend alembic upgrade head                      # apply migrations
docker compose exec backend python -m app.seed                        # demo data (local only)
docker compose exec backend python -m app.scripts.sync_legislation    # National Assembly + counties
docker compose exec backend python -m app.scripts.sync_county_bills   # counties only
```

Act texts (for the Act reader and the check of what reached the law):

```bash
docker compose exec backend python -m app.scripts.download_county_acts      # every Act PDF on Nairobi's Acts page
docker compose exec backend python -m app.scripts.act_library county        # load them onto their bills
docker compose exec backend python -m app.scripts.trace_acts --parliament   # Acts Parliament publishes (free)
docker compose exec backend python -m app.scripts.act_library missing       # what is still missing, and where it is
docker compose exec backend python -m app.scripts.trace_acts --dir /app/var/acts/batch4   # Kenya Law PDFs downloaded by hand
```

Kenya Law blocks automated downloads and asks that its content not be used as AI input, so its Acts are downloaded by a person in a browser.

**Putting the trace in production.** Reading reports (OCR) and analysing them (Gemini) is done once, locally. `trace_bundle` then copies every step of the trace (committee reports with their text and entries, the analysis of each submission, House decisions, and final Acts) to production:

```bash
docker compose exec backend python -m app.scripts.trace_bundle export      # -> var/trace_bundle.json.gz
docker compose exec -e DATABASE_URL="postgresql+asyncpg://<production>" backend python -m app.scripts.trace_bundle import
```

Run production's Parliament and county syncs first so its bills exist. Records match by what identifies them outside the database (a report's official PDF address, a bill's identifier), and where production already has a report under another id, every reference to it is rewritten to production's ids. Running it again keeps what is there (`--replace` refreshes it), and entries already matched to citizens' submissions are never replaced. PDF files stay on the machine that loaded them; in production the Act reader shows the text, and "Download the Act (PDF)" opens the official copy on Parliament's or the county assembly's site when there is one.

A database created by the seed script has no append-only triggers. To match production, stamp it and install the triggers as described in [docs/DB.md](docs/DB.md#migrations).

After changing frontend code, rebuild the frontend container (`docker compose up -d --build frontend`) and hard-refresh the browser (Ctrl+Shift+R); the app registers a service worker.

### Frontend dev server

```bash
npm ci
npm run dev
```

For a production build and type check:

```bash
npm run typecheck
npm run build
```

Point the frontend at the API by creating `.env.local`. Use port 8001 for the Docker Compose backend (8000 if you run `uvicorn` yourself):

```text
VITE_API_URL=http://localhost:8001/api/v1
```

### Seed data

```bash
cd backend
python -m app.seed
```

The seed set includes three institutions, unclaimed profiles, simulated bills, sample receipts, reports, report entries, matches, notices, and demo accounts. The current bill catalogue is supplied through the Parliament legislation sync; seeded bills are separate local/demo records. Do not use seed data as evidence of real legislative activity.

## Demo accounts (local only)

After `python -m app.seed`, sign in at `/login` with password `password123`:

| Account | Role |
|---|---|
| `jane@example.com` | Citizen |
| `mod@example.com` | Moderator (`reviewer`) |
| `committee@example.com` | Clerk's Office (`committee_officer`) |
| `admin@example.com` | Administrator |

These passwords are published, so the seed script refuses to run against a hosted database. The live site has no demo accounts.

## CI/CD

- **Netlify** builds and deploys the frontend from GitHub on every push to `main`.
- **Render** builds and deploys the API from GitHub using `backend/Dockerfile`, with `/health` as its health check.
- **GitHub Actions** (`.github/workflows/sync.yml`) runs the Parliament and county sync against the production database every night at 02:00 UTC.
- Tests run locally before each push (see [Testing](#testing)); running them in GitHub Actions on every pull request is a next step.

## Functional requirements (reported status)

| ID | Requirement | Frontend | Backend |
|---|---|---|---|
| FR1 | Submit view and issue receipt | Implemented | Implemented |
| FR2 | Append-only hash chain | Implemented | Implemented |
| FR3 | Committee-report ingestion (PDF) | UI | Implemented |
| FR4 | OCR fallback | — | Implemented |
| FR5 | Match proposals generated after report ingestion | Implemented | Implemented |
| FR6 | Human review | Implemented | Implemented |
| FR7 | Receipt lookup and outcome trail | Implemented | Implemented |
| FR8 | Notice adequacy tracker | Implemented | Implemented |
| FR9 | Representative profiles | Implemented | Implemented |
| FR10 | Offline drafts | Implemented; auto-sync added, live API verification pending | — |
| FR11 | Moderation and appeals | Implemented | Implemented |
| FR12 | Anonymized export | Implemented | Implemented |

Uploading a report creates match proposals for moderator review (repeat uploads do not duplicate them), and report entries can be corrected and verified on the server.

## Status vocabulary

- **Submission/outcome:** awaiting committee report · adopted · amended · rejected with reasons · not addressed
- **Representative:** unclaimed · verified and active · verified but inactive
- **Profile labels:** verified · pilot · simulated · unclaimed

## Testing

```bash
# Frontend
npm run typecheck
npm run build

# Backend (inside the container; the test database must contain "test" in its name)
docker compose exec -e TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/participation_platform_test backend python -m pytest
```

Create the test database once with `docker compose exec postgres psql -U postgres -c "create database participation_platform_test"`. The tests install the same append-only triggers as production, so code that tries to change a receipt fails in tests too. The `evaluation/` folder is mounted into the backend container for the report-parsing fixtures.

Latest local run (14 November 2026): **248 passed** across 20 test modules, **87% line coverage** of `app/` (it was 97% before the House and Act tracing scripts, which are not yet fully tested). Coverage includes:

- **Receipts and the chain:** tamper detection (edited text, deleted receipt, swapped document), append-only enforcement, edits and versions.
- **Participation rules:** when a bill accepts views, one submission per bill, document uploads.
- **Submission stages**, from received to outcome.
- **Access and abuse:** committee scope, rate limits and sign-in lockout, AI-manipulation guards.
- **Data sync:** National Assembly tracker formats, county parsers, committee assignment.
- **Reports:** report parsing and OCR fixtures.
- **Tracing:** report analysis, House and Act evidence checks, and a receipt followed into the Act.
- **Counties and production copy:** Nairobi Acts and reports, Act library loading, and the trace bundle never replacing entries matched to submissions.
- **Performance:** the start-up data leaving out report texts and being compressed.

Lighthouse (14 November 2026): home page 99 on desktop and 74–78 on mobile; bills page 95 on desktop and 65–68 on mobile. Accessibility and best practices score 100. Details are in the technical report.

## Deploying this release

The hosted services are configured as before: Netlify builds the frontend with `VITE_API_URL`, Render runs `backend/Dockerfile` with `DATABASE_URL`, `JWT_SECRET_KEY` and `CORS_ORIGINS`, and Neon stores the data (`ssl=require`). Never put secrets in a `VITE_*` variable.

1. Back up Neon (or create a branch) and test the steps there first.
2. Push to `main` so Render and Netlify deploy, then run `alembic upgrade head` against Neon. Migrations only add tables and columns; receipts are never rewritten. Never edit a migration that has already run.
3. Run `python -m app.scripts.sync_legislation` against Neon, or let the nightly GitHub Actions sync do it. This updates National Assembly stages, adds the county bills, Acts and reports, and assigns committees.
4. Copy the trace with `trace_bundle export` locally and `trace_bundle import` against Neon (see [Running locally](#running-locally)).
5. In **Administration → Committee assignments**, confirm the subject-matter suggestions, starting with bills open for views.
6. Smoke test: `/health`, sign in, submit, edit, look up and verify a receipt, a moderator decision, and a Clerk's Office account seeing only its committee.

Platform notes:

- **Cold starts:** Render's free tier sleeps when idle, so the first request can take 30+ seconds.
- **Storage:** uploaded committee reports and memoranda need a persistent disk (`REPORT_STORAGE_DIR`).
- **Gemini:** set `GEMINI_API_KEY` to enable AI proposals and reworded notifications. Without it, bilingual templates are used and no AI proposals are made.
- **Production chain:** demo data was removed from production on 7 November 2026 and the chain resealed under an audit-log entry; it now verifies. The seed script refuses non-local databases.

## Project structure

```text
├── backend/
│   ├── app/
│   │   ├── api/routes.py            # REST API
│   │   ├── participation.py         # when a bill accepts views
│   │   ├── submission_stage.py      # a submission's journey
│   │   ├── committee_assignment.py  # committees for bills; county committees
│   │   ├── rate_limit.py            # request limits and sign-in lockout
│   │   ├── scripts/                 # syncs (Parliament, counties), analyse_reports, trace_house, trace_acts,
│   │   │                            # act_library, download_county_acts, fill_gaps, trace_bundle
│   │   └── services/                # receipts, ingestion (OCR), matching, report analysis, House and Act tracing
│   ├── alembic/versions/            # migrations
│   ├── tests/                       # 20 pytest modules
│   ├── requirements.txt
│   └── Dockerfile
├── src/                             # React frontend
│   ├── pages/                       # role home pages, bills, Act reader, submit, receipts, moderation, admin, Clerk's Office
│   ├── components/                  # Layout, UI, Participation (stage pill, progress tracker), trace summary
│   ├── context/AppContext.tsx       # app data; Clerk's Office scoping
│   ├── api/                         # HTTP client and endpoints
│   └── utils/                       # submission stages, offline drafts, links
├── public/                          # icons, service worker, offline page
├── docs/                            # SYSTEM, API, DB, EVALUATION, diagrams, technical report (PDF and Typst source)
├── evaluation/                      # matching and usability evaluation scripts, data and results
├── .github/workflows/sync.yml       # nightly production sync
├── docker-compose.yml
└── package.json
```

## Limitations

- Submissions are not yet forwarded to committee clerks, so the platform cannot prove a view reached the committee.
- Committee reports often summarise themes rather than individual views, so some views will be "Not addressed in the report" even where a general response exists.
- County coverage is two assemblies. Neither publishes bill stages; Nairobi publishes committee reports as scans, which OCR reads imperfectly, and Trans Nzoia publishes none on bills.
- Subject-matter committee assignments need administrator confirmation.
- The interface is English-only; notifications are English and Kiswahili.
- The bills list (about 1 MB, 80 KB compressed) is sent in one response; on a slow phone the bills page takes about 5 s to show. Server-side paging is the next fix. The start-up data is about 230 KB compressed: report texts and entries load only on the pages that need them.
- Online submissions are not statistically representative of the public.

## Legal context

The Constitution of Kenya 2010 — Articles 10(2)(a), 118(1)(b) and 196 — and National Assembly Standing Order 127 provide the context for public participation. The platform does not replace official legislative records or proceedings.

## License

© 2026 Participation Traceability Platform — Kenya Pilot. All rights reserved.
