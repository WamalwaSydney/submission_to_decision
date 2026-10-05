Submission-to-Decision Traceability Platform — Kenya

A web application designed to help citizens trace public submissions on bills in Kenya’s National and County Legislatures—from lodging to the committee’s recorded treatment.


Deployment status: the current deployment plan uses Netlify for the Vite frontend, Render for the FastAPI API, and Neon for PostgreSQL. The frontend is configured to call the Render API through the build-time `VITE_API_URL` variable. The Figma/export ZIP shared for review is a static UI capture, not the complete runnable application; the setup instructions assume the full project source tree described below is present in the repository.

Project links

•GitHub repository: https://github.com/WamalwaSydney/submission_to_decision.git
•Figma prototype: https://www.figma.com/design/0xIxRyyV8vdUSg8vsUHtxx/Participation-Trace-%E2%80%94-Kenya?node-id=0-1&t=iD8kLK1UBjEuoB1B-1

Participation Trace — Kenya

•Video demonstration (5–10 minutes): Add the video link here.

•Live application: Add an AWS URL after the deployment is working; otherwise remove this line.

Overview

Public participation can feel like a one-way process when people do not know whether their views were recorded or what happened to them. Participation Trace is designed to let citizens lodge views against tracked bills, receive tamper-evident, hash-chained receipts, and later inspect a public outcome trail.

Committee reports are ingested with an OCR fallback. The system can propose matches between submissions and report entries; a human moderator confirms or rejects each proposed match before it appears as a confirmed outcome.

Core principle — adoption-independence: The platform does not depend on a representative registering. Accountability evidence is based on institution-published committee reports and recorded moderation, not representative engagement.

This is an independent pilot. It is not an official legislative record system, does not guarantee a response or resolution, and does not provide legal advice. A platform receipt proves what this platform recorded and when; it does not, by itself, prove endorsement, adoption, or official receipt by an Assembly. Demo records are simulated.

Pilot scope

•National Assembly: legislative tracking.

•Nairobi County Assembly: pilot citizen activity in two constituencies.

•Trans Nzoia County Assembly: pilot citizen activity in three wards.

Technology stack

Layer
Technology
Purpose
Frontend
React, TypeScript, Vite, Material UI, Tailwind CSS
Responsive, mobile-first user interface
Backend
FastAPI, Python, REST
Application API and server-side workflows
Database
PostgreSQL 15+; SQLAlchemy 2; Alembic
Relational records, schema, and migrations
Integrity
SHA-256 / Web Crypto API
Tamper-evident receipt-chain hashing and verification
Authentication
JWT, role-based access, argon2 password hashing
Authenticated roles and endpoint access
Report processing
pdfplumber / PyMuPDF, Tesseract OCR fallback
Extract text from committee reports
Matching
Clause rules and rapidfuzz similarity
Suggest candidate links for human review
Local development
Docker Compose
Run the API and database locally
Current deployment
Netlify, Render, Neon PostgreSQL
Static Vite frontend, containerized FastAPI API, managed PostgreSQL database
CI/CD target
GitHub integration with Netlify and Render
Build, health checks, migrations, and controlled deploys




Current deployment plan — Netlify + Render + Neon

The current deployment is split into three services:

| Layer | Service | Configuration |
|---|---|---|
| Frontend | Netlify | `npm run build`, publish `dist`, and `VITE_API_URL=https://<render-service>.onrender.com/api/v1` |
| API | Render Web Service | `backend/Dockerfile`; `DATABASE_URL`, `JWT_SECRET_KEY`, and `CORS_ORIGINS` environment variables |
| Database | Neon PostgreSQL | Rotated `postgresql+asyncpg://` connection string with `ssl=require`; stored only on Render |

Render variables:

```text
DATABASE_URL=postgresql+asyncpg://<user>:<rotated-password>@<neon-host>/<database>?ssl=require
JWT_SECRET_KEY=<long-random-secret>
CORS_ORIGINS=https://<netlify-site>.netlify.app
```

Netlify variable:

```text
VITE_API_URL=https://<render-service>.onrender.com/api/v1
```

Never place database credentials or `JWT_SECRET_KEY` in Netlify or any `VITE_*` variable. The frontend now uses `src/api/client.ts` and `src/api/endpoints.ts`; bootstrap data, authentication, receipt submission, receipt lookup, chain verification, clerk uploads, notices, profile claims, and moderator match decisions use the Render API.

Deployment order:

1. Rotate any Neon password and JWT secret that were previously committed or shared.
2. Set the three backend variables in Render and deploy the API.
3. Verify `GET https://<render-service>.onrender.com/health` returns HTTP 200.
4. Seed or migrate Neon through a controlled Render release step.
5. Add `VITE_API_URL` in Netlify under **Site configuration → Environment variables**, select Production, and redeploy.
6. Check the browser Network tab; requests must use the Render hostname.
7. If CORS fails, add the exact Netlify origin to `CORS_ORIGINS` on Render and redeploy.

Main workflow

1.A visitor browses tracked bills and public notices.

2.A citizen submits a view against a bill and, optionally, a clause.

3.The platform issues a receipt and records the submission in the hash chain.

4.A clerk uploads or records committee-report material.

5.The system extracts report text and proposes possible matches.

6.A moderator confirms or rejects each match and records the decision.

7.Public receipt and bill pages display the trace, confirmed status, and stated committee reason.

Quick start — local development

Frontend

From the repository root:

Bash


npm ci
npm run dev



For a production build and type check:

Bash


npm run typecheck
npm run build



Full stack with Docker Compose

Bash


docker compose up -d



The local Compose configuration is intended to start:

•
PostgreSQL on port 5432

•
FastAPI backend on port 8000

•
React frontend on port 3000

Seed data

Bash


cd backend
python -m app.seed



The seed set described for the project includes three institutions, unclaimed profiles, simulated bills, sample receipts, reports, report entries, matches, notices, and demo accounts. Do not use seed data as evidence of real legislative activity.

Demo accounts

Sign in at /login using a simulated account:

•Jane Citizen — citizen

•Hon. Simulated Rep — representative

•Dr. Researcher — researcher

•Mod User — moderator

•Admin User — administrator

•Clerk User — clerk

These are demo accounts, not production credentials. Never use real passwords in a demo environment.

Legacy AWS alternative

The proposed AWS design separates static frontend hosting, API compute, relational data, and uploaded committee documents. The architecture diagram is in docs/architecture.png, with editable source in docs/architecture.mmd.

Target architecture

Component
AWS service
Deployment approach
Frontend
AWS Amplify Hosting
Connect the GitHub repository; build the Vite frontend with npm ci && npm run build; publish dist. Set the public API base URL as a build-time variable. Do not put secrets in frontend variables.
API
Amazon API Gateway HTTP API + AWS Lambda
Adapt the FastAPI app to Lambda with an ASGI adapter such as Mangum. The exact handler and packaging configuration must match the committed code. This avoids an always-on web server for a low-traffic demo, but requires serverless deployment work.
Relational database
Amazon RDS for PostgreSQL
Use a small eligible PostgreSQL instance for a simulated-data demo. Keep the database private in a VPC and allow connections only from the API’s security group. Configure backups and rehearse a restore before using real pilot data.
Committee report files
Amazon S3
Store files in a private bucket with Block Public Access enabled. Prefer short-lived pre-signed uploads/downloads; store object keys and metadata in PostgreSQL. Use lifecycle rules for temporary demo files.
Report processing
Lambda function triggered asynchronously from S3 (target)
Process uploaded reports outside the citizen/API request path. Verify that pdfplumber/PyMuPDF and the Tesseract fallback fit the selected Lambda package/runtime limits; if not, simplify the demo workflow or move OCR to a separately costed container/worker.
Secrets and permissions
IAM roles; Systems Manager Parameter Store or Secrets Manager
Give each function only the permissions it needs. Keep database credentials, JWT signing keys, and storage settings out of Git and the browser bundle.
Logs and alerts
Amazon CloudWatch and AWS Billing/Budgets
Keep a short log-retention period for the demo, monitor API/database errors, and set billing notifications before creating resources.
Delivery automation
GitHub Actions
Run frontend checks/build and backend tests first. Use short-lived AWS credentials through GitHub OIDC with a least-privilege IAM role; do not store long-lived AWS keys in GitHub secrets if OIDC can be configured.




Region: Choose one AWS region that supports the selected services and is suitable for users in Kenya. Keep Lambda and RDS in the same region/VPC where possible. Confirm service availability and compare latency before creating production resources.

Deployment sequence

1.Prepare the repository: push the actual frontend and backend source, lockfiles, tests, Docker Compose for local development, database migrations, and an .env.example with placeholder values only. The Figma/export ZIP alone is not deployable as the full app.

2.Deploy the frontend: connect Amplify Hosting to GitHub, configure the Vite build command and dist output directory, and test the deployed site with simulated data.

3.Deploy the API: adapt FastAPI to the Lambda handler, define the API Gateway routes, configure CORS for the exact Amplify site origin, and add a health endpoint. Test authentication and authorization on the server, not only by hiding UI navigation.

4.Provision data services: create private RDS PostgreSQL and a private S3 bucket. Apply the schema/migrations using a controlled release step with access to the private database. Use backward-compatible migrations and test them on a separate staging database first.

5.Connect the app: set the frontend API URL, configure API-to-database access and least-privilege S3 access, and exercise receipt creation, hash verification, report ingestion, proposed matching, moderator confirmation, and public outcome views end-to-end.

6.Run CI before production deploys: require GitHub Actions checks to pass before Amplify and Lambda deployments. Keep staging data and production data separate. If using the AWS SAM/CloudFormation approach, commit the infrastructure template and review changes before applying them.

7.Validate operations: confirm HTTPS, health checks, access restrictions, logs, alarms, backup retention, and a tested restore procedure. Publish a live demo URL only after these checks pass.

Free-plan and cost expectations

AWS is not a promise of permanently free hosting. Under the current AWS Free account plan, new customers receive $100 in credits and may earn up to $100 more. The Free plan ends after six months or when credits are exhausted, whichever comes first. AWS then suspends the Free-plan account and associated resources; data is retained for 90 days, after which it may be permanently deleted if the account is not upgraded. Eligibility is limited to new AWS customers, and the Free plan cannot use every AWS service. See 

AWS Free Tier FAQs and 

AWS account-plan details.

AWS lists Amplify Hosting, Lambda, S3, and RDS among its web-app offers; exact eligibility and available limits depend on the account plan and the current offer. Check the AWS console’s Free Tier eligibility and estimated charges before provisioning. See 

AWS web-app offers, 

Amplify pricing, 

Lambda pricing, and 

RDS Free Tier.

Cost-sensitive choices:

•Prefer Lambda over an always-on API service for a low-traffic demo. AWS App Runner is simpler for a normal FastAPI container but bills for provisioned capacity while idle, so it is not the default no-cost choice. See 

App Runner pricing.

•RDS, S3, API Gateway, data transfer, logs, snapshots, and any VPC egress can have charges after applicable credits or limits. Avoid adding a NAT Gateway unless the architecture needs it and its cost is understood.

•Set billing alerts, keep the dataset and uploaded files small, and delete temporary demo resources when finished. Before the Free plan expires, export any data you need and review or remove active resources. See 

avoiding unexpected charges.

•Do not deploy real civic submissions on an unbacked or temporary demo setup. Use simulated or non-sensitive data until authentication, authorization, data retention, monitoring, backup, and restore have been tested.

Project structure

Plain Text


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
├── src/                         # React frontend
│   ├── App.tsx
│   ├── types.ts
│   ├── context/AppContext.tsx
│   ├── data/seed.ts
│   ├── utils/hashChain.ts
│   ├── utils/offline.ts
│   ├── components/
│   └── pages/
├── backend/                     # FastAPI application
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



Adjust this tree to match the repository exactly before submission. Add the AWS deployment template and any Lambda adapter/handler files when they exist; do not list files that have not been committed.

Functional requirements (reported status)

ID
Requirement
Frontend
Backend
FR1
Submit view and issue receipt
Implemented
Implemented
FR2
Append-only hash chain
Implemented
Implemented
FR3
Committee-report ingestion (PDF)
UI
Implemented
FR4
OCR fallback
—
Implemented
FR5
Match proposals
UI
Implemented
FR6
Human review
Implemented
Implemented
FR7
Receipt lookup and outcome trail
Implemented
Implemented
FR8
Notice adequacy tracker
Implemented
Implemented
FR9
Representative profiles
Implemented
Implemented
FR10
Offline drafts
Implemented
—
FR11
Moderation and appeals
Implemented
Implemented
FR12
Anonymized export
Implemented
Implemented




These statuses are based on the current README supplied for editing. Before submission, verify each item against the pushed source and demo; distinguish working end-to-end behavior from UI-only or simulated behavior.

Status vocabulary

Submission/outcome: awaiting committee report · adopted · amended · rejected with reasons · not addressed

Representative: unclaimed · verified and active · verified but inactive

Profile labels: verified · pilot · simulated · unclaimed

Testing

Bash


# Frontend
npm run typecheck
npm run build

# Backend
cd backend
pytest tests/



Key test areas described by the project include hash-chain tamper detection, append-only enforcement, role/endpoint permissions, OCR fallback, matching quality, and offline draft behavior. Only claim tests pass after running them in the submitted repository.

Design and accessibility

Design considerations include a mobile-first layout, low-bandwidth use, role-aware navigation, offline drafts, explicit privacy choices, and clear status labels. Figma exports and screenshots should be stored under docs/ and labelled as design evidence, not as proof that every interaction is implemented.

Legal context

The Constitution of Kenya 2010, including Articles 10(2)(a), 118(1)(b), and 196, provides context for public-participation design. This platform is not legal advice and does not replace official legislative records or proceedings.

Limitations

•The platform cannot require a representative or committee to engage.

•It cannot guarantee that a concern is resolved.

•Online submissions are not statistically representative of the public.

•Device and connectivity gaps remain a pilot limitation.

•The current interface is English-only; Kiswahili is a future milestone.

•AWS Free-plan credits and service offers are temporary and limited; they are not a production availability or backup guarantee.

License

© 2026 Participation Traceability Platform — Kenya Pilot.