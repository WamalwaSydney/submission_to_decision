# Submission-to-Decision Traceability Platform — Kenya

A web application designed to help citizens trace public submissions on bills in Kenya's National and County Legislatures, from lodging to the committee's recorded treatment.

> **Deployment status:** the app is deployed as three services: **Netlify** (Vite frontend), **Render** (FastAPI API, Docker) and **Neon** (PostgreSQL). The frontend reaches the API through the build-time `VITE_API_URL` variable. The Figma/export ZIP shared for review is a static UI capture, not the complete runnable application; the setup instructions assume the full project source tree described below is present in the repository.

## Project links

- **GitHub repository:** https://github.com/WamalwaSydney/submission_to_decision.git
- **Figma prototype:** [Participation Trace — Kenya](https://www.figma.com/design/0xIxRyyV8vdUSg8vsUHtxx/Participation-Trace-%E2%80%94-Kenya?node-id=0-1&t=iD8kLK1UBjEuoB1B-1)
- **Video demonstration (5–10 minutes):** _Add the video link here._
- **Live application (Netlify):** _Add `https://uraia.netlify.app` once deployment is verified._
- **API health check (Render):** _Add `https://submission-to-decision.onrender.com/health` once deployed._

## Overview

Public participation can feel like a one-way process when people do not know whether their views were recorded or what happened to them. Participation Trace lets citizens lodge views against tracked bills, receive tamper-evident, hash-chained receipts, and later inspect a public outcome trail.

Committee reports are ingested with an OCR fallback. The system can propose matches between submissions and report entries; a human moderator confirms or rejects each proposed match before it appears as a confirmed outcome.

**Core principle — adoption-independence:** the platform does not depend on a representative registering. Accountability evidence is based on institution-published committee reports and recorded moderation, not representative engagement.

This is an independent pilot. It is not an official legislative record system, does not guarantee a response or resolution, and does not provide legal advice. A platform receipt proves what this platform recorded and when; it does not, by itself, prove endorsement, adoption, or official receipt by an Assembly. Demo records are simulated.

## Pilot scope

- **National Assembly:** legislative tracking.
- **Nairobi County Assembly:** pilot citizen activity in two constituencies.
- **Trans Nzoia County Assembly:** pilot citizen activity in three wards.

## Technology stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React, TypeScript, Vite, Material UI, Tailwind CSS | Responsive, mobile-first user interface |
| Backend | FastAPI, Python, REST | Application API and server-side workflows |
| Database | PostgreSQL 15+, SQLAlchemy 2 (async, `asyncpg`), Alembic | Relational records, schema, and migrations |
| Integrity | SHA-256 / Web Crypto API | Tamper-evident receipt-chain hashing and verification |
| Authentication | JWT, role-based access, argon2 password hashing | Authenticated roles and endpoint access |
| Report processing | pdfplumber / PyMuPDF, Tesseract OCR fallback | Extract text from committee reports |
| Matching | Clause rules and rapidfuzz similarity | Suggest candidate links for human review |
| Local development | Docker Compose | Run the API and database locally |
| Hosting | Netlify, Render, Neon | Static frontend, containerized API, managed PostgreSQL |
| CI/CD | GitHub integration with Netlify and Render | Build, health checks, migrations, and controlled deploys |

## Deployment — Netlify + Render + Neon

The deployment is split into three services:

| Layer | Service | Configuration |
|---|---|---|
| Frontend | Netlify | Build command `npm run build`, publish directory `dist`, variable `VITE_API_URL` |
| API | Render Web Service (Docker) | Dockerfile at `backend/Dockerfile`; variables `DATABASE_URL`, `JWT_SECRET_KEY`, `CORS_ORIGINS` |
| Database | Neon PostgreSQL | `postgresql+asyncpg://` connection string with `ssl=require`, stored only on Render |

```text
Browser ──HTTPS──▶ Netlify (static Vite build)
   │
   └──HTTPS (VITE_API_URL)──▶ Render (FastAPI) ──TLS──▶ Neon (PostgreSQL)
```

### Environment variables

**Render (API service)**

```text
DATABASE_URL=postgresql+asyncpg://<user>:<rotated-password>@<neon-host>/<database>?ssl=require
JWT_SECRET_KEY=<long-random-secret>
CORS_ORIGINS=https://<netlify-site>.netlify.app
```

**Netlify (frontend)**

```text
VITE_API_URL=https://<render-service>.onrender.com/api/v1
```

> **Never** place database credentials or `JWT_SECRET_KEY` in Netlify or in any `VITE_*` variable. Anything prefixed `VITE_` is bundled into the public frontend. Commit only an `.env.example` containing placeholder values.

The frontend talks to the API through `src/api/client.ts` and `src/api/endpoints.ts`. Bootstrap data, authentication, receipt submission, receipt lookup, chain verification, clerk uploads, notices, profile claims, and moderator match decisions all go through the Render API.

### Deployment order

1. **Rotate secrets.** Rotate any Neon password and JWT secret that were previously committed or shared.
2. **Configure and deploy the API.** Set `DATABASE_URL`, `JWT_SECRET_KEY` and `CORS_ORIGINS` in Render, then deploy from `backend/Dockerfile`.
3. **Check health.** Confirm `GET https://<render-service>.onrender.com/health` returns HTTP 200.
4. **Migrate and seed Neon** through a controlled step (see below), not on every request or on every container start.
5. **Configure the frontend.** In Netlify go to **Site configuration → Environment variables**, add `VITE_API_URL` for the Production scope, and redeploy.
6. **Verify in the browser.** Open the Network tab and confirm requests go to the Render hostname.
7. **Fix CORS if needed.** If requests are blocked, add the exact Netlify origin (scheme + host, no trailing slash, no path) to `CORS_ORIGINS` on Render and redeploy.

### Migrations and seeding

- Apply schema changes with Alembic against Neon as a deliberate release step, for example from a trusted machine using the rotated connection string, or through Render's pre-deploy command if your plan supports it:

  ```bash
  cd backend
  alembic upgrade head
  ```

- Seed demo data only on demo/staging databases:

  ```bash
  cd backend
  python -m app.seed
  ```

- Keep migrations backward-compatible and test them on a separate Neon branch or staging database before touching production data. Neon branching is convenient for this.

### Single-page-app routing on Netlify

React Router routes such as `/login` or `/receipts/<id>` need a fallback rule, otherwise refreshing a deep link returns a 404. Add either a `public/_redirects` file or a `netlify.toml` entry:

```text
/*    /index.html   200
```

### Platform behaviour to plan for

- **Cold starts.** Render's free web services spin down when idle, so the first request after a quiet period can be slow. Wait for `/health` before a live demo, or use a paid instance.
- **Neon auto-suspend.** Neon's free compute can suspend when idle and resume on the next connection, which adds a short delay. Make sure the API retries or tolerates the first connection.
- **Uploaded committee reports.** A Render web service's local filesystem is ephemeral unless a persistent disk is attached. Do not rely on local disk for uploaded PDFs; either attach a persistent disk, store the extracted text and file contents in the database, or use external object storage. Confirm which approach the code uses before the pilot.
- **Report processing.** PDF extraction and the Tesseract OCR fallback run inside the Docker container on Render. Make sure the Dockerfile installs Tesseract and that the instance has enough memory for large scanned reports.
- **Limits change.** Free-plan limits and pricing for all three providers change over time; check each provider's current plan page before relying on them.

## Main workflow

1. A visitor browses tracked bills and public notices.
2. A citizen submits a view against a bill and, optionally, a clause.
3. The platform issues a receipt and records the submission in the hash chain.
4. A clerk uploads or records committee-report material.
5. The system extracts report text and proposes possible matches.
6. A moderator confirms or rejects each match and records the decision.
7. Public receipt and bill pages display the trace, confirmed status, and stated committee reason.

## Quick start — local development

### Frontend

From the repository root:

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

The seed set includes three institutions, unclaimed profiles, simulated bills, sample receipts, reports, report entries, matches, notices, and demo accounts. Do not use seed data as evidence of real legislative activity.

## Demo accounts

Sign in at `/login` using a simulated account:

- Jane Citizen — citizen
- Hon. Simulated Rep — representative
- Dr. Researcher — researcher
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

Adjust this tree to match the repository exactly before submission, and do not list files that have not been committed. Add `netlify.toml`, `render.yaml`, an `alembic/` directory and `.env.example` once they exist.

## Functional requirements (reported status)

| ID | Requirement | Frontend | Backend |
|---|---|---|---|
| FR1 | Submit view and issue receipt | Implemented | Implemented |
| FR2 | Append-only hash chain | Implemented | Implemented |
| FR3 | Committee-report ingestion (PDF) | UI | Implemented |
| FR4 | OCR fallback | — | Implemented |
| FR5 | Match proposals | UI | Implemented |
| FR6 | Human review | Implemented | Implemented |
| FR7 | Receipt lookup and outcome trail | Implemented | Implemented |
| FR8 | Notice adequacy tracker | Implemented | Implemented |
| FR9 | Representative profiles | Implemented | Implemented |
| FR10 | Offline drafts | Implemented | — |
| FR11 | Moderation and appeals | Implemented | Implemented |
| FR12 | Anonymized export | Implemented | Implemented |

These statuses are based on the previous README. Before submission, verify each item against the pushed source and the live Netlify/Render deployment, and distinguish working end-to-end behavior from UI-only or simulated behavior.

## Status vocabulary

- **Submission/outcome:** awaiting committee report · adopted · amended · rejected with reasons · not addressed
- **Representative:** unclaimed · verified and active · verified but inactive
- **Profile labels:** verified · pilot · simulated · unclaimed

## Testing

```bash
# Frontend
npm run typecheck
npm run build

# Backend
cd backend
pytest tests/
```

Key test areas include hash-chain tamper detection, append-only enforcement, role/endpoint permissions, OCR fallback, matching quality, and offline draft behavior. Only claim tests pass after running them in the submitted repository.

After each deployment, also run a manual smoke test against the live URLs: `/health` returns 200, a demo user can sign in, a receipt can be created and looked up, chain verification passes, and a moderator decision is saved. Authorization must be enforced on the server, not only by hiding UI navigation.

## Security and data handling

- Secrets live only in Render's environment settings (and local untracked `.env` files). Never commit them, and rotate any that have been exposed.
- Neon connections require TLS (`ssl=require`).
- `CORS_ORIGINS` should list only the exact frontend origin(s) you use.
- Enable backups or point-in-time recovery on Neon appropriate to your plan and rehearse a restore before storing real pilot data.
- Use simulated or non-sensitive data until authentication, authorization, data retention, monitoring, backup, and restore have been tested.

## Design and accessibility

Design considerations include a mobile-first layout, low-bandwidth use, role-aware navigation, offline drafts, explicit privacy choices, and clear status labels. Figma exports and screenshots should be stored under `docs/` and labelled as design evidence, not as proof that every interaction is implemented.

## Legal context

The Constitution of Kenya 2010, including Articles 10(2)(a), 118(1)(b), and 196, provides context for public-participation design. This platform is not legal advice and does not replace official legislative records or proceedings.

## Limitations

- The platform cannot require a representative or committee to engage.
- It cannot guarantee that a concern is resolved.
- Online submissions are not statistically representative of the public.
- Device and connectivity gaps remain a pilot limitation.
- The current interface is English-only; Kiswahili is a future milestone.
- Free tiers on Netlify, Render and Neon are limited and can change; they are not a production availability or backup guarantee, and the API may have cold-start delays.

## License

© 2026 Participation Traceability Platform — Kenya Pilot. All rights reserved.