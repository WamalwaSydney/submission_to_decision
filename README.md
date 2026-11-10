# Submission-to-Decision Traceability Platform — Kenya

Participation Trace helps citizens follow their public-participation submissions on bills in Kenya's National Assembly and county assemblies, from the moment they send a view to the committee's recorded response.

> **Deployment status (8 November 2026):** the hosted API and database run the 6 November release, and demo data has been removed from the hosted database. Later changes (paginated tables, editing from every view, report ingestion table) are validated locally (201 backend tests in 15 modules with 97% line coverage, type check and production build) and are **not yet deployed**. See [Deploying this release](#deploying-this-release).

## Project links

- **GitHub repository:** https://github.com/WamalwaSydney/submission_to_decision.git
- **Figma prototype:** [Participation Trace — Kenya](https://www.figma.com/design/0xIxRyyV8vdUSg8vsUHtxx/Participation-Trace-%E2%80%94-Kenya?node-id=0-1&t=iD8kLK1UBjEuoB1B-1)
- **Video demonstration (5–10 minutes):** [_Video Link._](https://www.youtube.com/watch?v=WPp6CnCSf0Y)
- **Technical report (PDF, 2 pages):** [`docs/TECHNICAL_REPORT.pdf`](docs/TECHNICAL_REPORT.pdf) (source: [`docs/TECHNICAL_REPORT.typ`](docs/TECHNICAL_REPORT.typ))
- **Live application (Netlify):** https://uraia-4.netlify.app
- **API health check (Render):** https://submission-to-decision.onrender.com/health

## What the platform does

Public participation can feel one-way: people rarely learn whether their views were recorded or what happened to them. Participation Trace:

1. lists bills from the **National Assembly**, **Nairobi City County Assembly** and **Trans Nzoia County Assembly**, with each bill's stage and whether its committee is taking public views;
2. lets a citizen send **one view per bill** — typed, or uploaded as a memorandum — and edit it until the call for views closes;
3. issues a **tamper-evident, hash-chained receipt** that anyone can verify;
4. reads the **committee report** when it is tabled and proposes which part of it answers each view;
5. has a **moderator confirm or reject** every proposal, so no outcome is shown without a human decision;
6. shows each submission's stage in plain language: **Received → With the committee → Report published → Response under review → Adopted / Amended / Rejected with reasons / Not addressed in the report**.

**Scope:** tracing stops at the committee report, because that is where the legislature formally records what it heard from the public and how it treated each view. A platform receipt proves what this platform recorded and when; it does not prove the view reached the committee. This is an independent pilot, not an official legislative record, and not legal advice.

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
| County Acts (bills that became law) | Kenya Law county legislation pages | same |
| County committees | Each assembly's published committee list | `backend/app/committee_assignment.py` |
| Which committee handles a bill | Official evidence; otherwise suggested from the bill's subject and confirmed by an administrator | same |

Neither county assembly publishes a bill's current stage online, so county bills show **"Published by the assembly"** until a Clerk's Office account records the stage or the bill appears on Kenya Law as an Act. The Parliament sync runs the county sync and committee assignment at the end. Seed data (`python -m app.seed`) is simulated and kept separate from synced bills.

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

More detail: [docs/SYSTEM.md](docs/SYSTEM.md) (architecture and rules), [docs/API.md](docs/API.md), [docs/DB.md](docs/DB.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/EVALUATION.md](docs/EVALUATION.md).

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

Point the frontend at a local API by creating `.env.local`:

```text
VITE_API_URL=http://localhost:8000/api/v1
```

### Full stack with Docker Compose

```bash
docker compose up -d
```

The local Compose configuration is intended to start:

- PostgreSQL on port 5432
- FastAPI backend on port 8000
- React frontend on port 3000

Local development uses the Compose PostgreSQL container, not Neon. Do not point local experiments at the production Neon database.

### Seed data

```bash
cd backend
python -m app.seed
```

The seed set includes three institutions, unclaimed profiles, simulated bills, sample receipts, reports, report entries, matches, notices, and demo accounts. The current bill catalogue is supplied through the Parliament legislation sync; seeded bills are separate local/demo records. Do not use seed data as evidence of real legislative activity.

## Demo accounts

Sign in at `/login` using a simulated account:

- Jane Citizen — citizen
- Hon. Simulated Rep — representative
- Mod User — moderator
- Admin User — administrator
- Clerk User — clerk

These are demo accounts, not production credentials. Never use real passwords in a demo environment, and do not seed demo accounts into a database that holds real pilot data.

## CI/CD

- **Netlify** builds and deploys the frontend from GitHub on push to the production branch; pull requests can get deploy previews.
- **Render** builds and deploys the API from GitHub using `backend/Dockerfile`, and uses `/health` as its health check path.
- **GitHub Actions** (in `.github/workflows/`) should run `npm run typecheck`, `npm run build` and `pytest backend/tests/` on every pull request, and branch protection should require them to pass before merging to the production branch.
- Keep staging and production data separate (for example separate Neon branches or databases, with separate Render services and Netlify contexts).

## Project structure

```text
├── README.md
├── docs/
│   ├── DECISIONS.md
│   ├── SYSTEM.md
│   ├── API.md
│   ├── DB.md
│   └── diagrams/
│       ├── usecase.puml
│       ├── class.puml
│       ├── erd.puml
│       ├── architecture.puml
│       ├── sequence-submission.puml
│       └── sequence-profile.puml
├── src/                         # React frontend (deployed to Netlify)
│   ├── App.tsx
│   ├── types.ts
│   ├── api/
│   │   ├── client.ts
│   │   └── endpoints.ts
│   ├── context/AppContext.tsx
│   ├── data/seed.ts
│   ├── utils/hashChain.ts
│   ├── utils/offline.ts
│   ├── components/
│   └── pages/
├── backend/                     # FastAPI application (deployed to Render)
│   ├── app/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── auth.py
│   │   ├── seed.py
│   │   ├── api/routes.py
│   │   └── services/
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── docker-compose.yml
├── .github/workflows/
└── package.json
```

This archive includes the Alembic directory and `.env.example`. Deployment configuration should be supplied by the hosting environment or added before production deployment; do not claim a live deployment unless the frontend/API/database smoke test has been completed against the deployed services.

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

Report upload now generates idempotent match proposals for moderator review. Report entry correction and report verification are server-backed. Before submission, still distinguish working end-to-end behavior from UI-only or simulated behavior and complete a live smoke test if deployment is claimed.

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

Latest local run (8 November 2026): **201 passed** across 15 test modules, **97% line coverage** of `app/`. Coverage includes:

- **Receipts and the chain:** tamper detection (edited text, deleted receipt, swapped document), append-only enforcement, edits and versions.
- **Participation rules:** when a bill accepts views, one submission per bill, document uploads.
- **Submission stages**, from received to outcome.
- **Access and abuse:** committee scope, rate limits and sign-in lockout, AI-manipulation guards.
- **Data sync:** National Assembly tracker formats, county parsers, committee assignment.
- **Reports:** report parsing and OCR fixtures.

## Deploying this release

The hosted services are configured as before: Netlify builds the frontend with `VITE_API_URL`, Render runs `backend/Dockerfile` with `DATABASE_URL`, `JWT_SECRET_KEY` and `CORS_ORIGINS`, and Neon stores the data (`ssl=require`). Never put secrets in a `VITE_*` variable.

1. Back up Neon (or create a branch) and test the steps there first.
2. Deploy the API, then run `alembic upgrade head` against Neon. The two new migrations add columns only; receipts are never rewritten.
3. Run `python -m app.scripts.sync_legislation` against Neon. This updates National Assembly stages, adds the county bills and committees, and assigns committees.
4. Deploy the frontend.
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
│   │   ├── scripts/                 # sync_legislation.py, sync_county_bills.py
│   │   └── services/                # receipts, ingestion, matching, documents, notifications, report worker
│   ├── alembic/versions/            # migrations
│   └── tests/
├── src/
│   ├── pages/                       # role home pages, bills, submit, receipts, moderation, admin, Clerk's Office
│   ├── components/                  # Layout, UI, Participation (stage pill, progress tracker)
│   ├── context/AppContext.tsx       # app data; Clerk's Office scoping
│   └── utils/submissionStage.ts     # stage labels shared with the backend rules
├── docs/                            # SYSTEM, API, DB, DECISIONS, EVALUATION, technical report
├── evaluation/                      # evaluation scripts and synthetic fixtures
└── docker-compose.yml
```

## Limitations

- Submissions are not yet forwarded to committee clerks, so the platform cannot prove a view reached the committee.
- Committee reports often summarise themes rather than individual views, so some views will be "Not addressed in the report" even where a general response exists.
- County coverage is two assemblies, and their websites publish neither bill stages nor committee reports.
- Subject-matter committee assignments need administrator confirmation.
- The interface is English-only; notifications are English and Kiswahili.
- The app loads about 2.3 MB of data at start-up, which is slow on mobile data.
- Online submissions are not statistically representative of the public.

## Legal context

The Constitution of Kenya 2010 — Articles 10(2)(a), 118(1)(b) and 196 — and National Assembly Standing Order 127 provide the context for public participation. The platform does not replace official legislative records or proceedings.

## License

© 2026 Participation Traceability Platform — Kenya Pilot. All rights reserved.
