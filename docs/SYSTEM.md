# System Architecture

## Overview

The platform follows a four-layer architecture (§3.5):

1. **Web Clients (React):** Responsive UI for all roles
2. **API & Authorization Layer (FastAPI):** REST endpoints, RBAC, rate limiting
3. **Civic Domain Services:** receipt, ingestion, linking, notice, profile
4. **Data & Audit Layer:** PostgreSQL, file storage, FTS, append-only audit log

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Clients (React)                       │
│  Public │ Citizen │ Representative │ Moderator │ Admin │ Clerk│
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS / REST
┌──────────────────────────▼──────────────────────────────────┐
│              API & Authorization (FastAPI)                   │
│  JWT Auth │ Role Validation │ Rate Limiting │ Domain Rules  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                Civic Domain Services                         │
│  receipt_service │ ingestion_service │ linking_service       │
│  notice_service  │ profile_service                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                Data & Audit Layer                            │
│  PostgreSQL │ File Storage │ FTS Index │ Audit Log (append) │
└─────────────────────────────────────────────────────────────┘
```

## Cross-Domain Relationships

- Receipt → LegislativeItem (targets)
- Receipt → SubmissionMatch (reviews)
- ReportEntry → SubmissionMatch (matched by)
- NoticeRecord → LegislativeItem (announces)
- CommitteeReport → LegislativeItem (reported on by)
- User → ParticipationReceipt (submits)
- User → ModerationAction (reports)

## Notice record flow

The Clerk’s Office notice screen loads `GET /bills` and `GET /committees` in parallel. The bill picker therefore includes all live non-simulated bills, whether synchronized from an external source or ingested locally. Institution choices are the distinct institutions from active committees plus institutions represented by those live bills.

Creating and editing notices use multipart form requests to `POST /notices` and `PUT /notices/{id}`. The API validates the bill UUID, rejects simulated or missing bills, validates the institution against the active platform set, and enforces that the notice window end is not before its start. The edit form hydrates all persisted fields, including the institution and `bill_text_accessible` flag.

When a notice marks bill text as accessible, the UI links to the bill Documents section. External document URLs redirect to their HTTPS source, while uploaded bill documents are served through `GET /bills/{id}/documents/{document_index}` from configured storage. Filesystem storage references are never sent to the browser as direct paths.

## Deployment

```
┌─────────────────────────────────────────────────────┐
│                  Docker Compose                      │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Frontend │  │ Backend  │  │   PostgreSQL     │  │
│  │  (Nginx) │  │ (FastAPI)│  │   (Data + FTS)   │  │
│  │  :3000   │  │  :8000   │  │     :5432        │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  GitHub Actions (Scheduled Sync)             │   │
│  │  - Fetch bills from Kenya Law / Parliament   │   │
│  │  - Extract text with pdfplumber              │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Security

- **Authentication:** JWT with 1-hour expiry, argon2id password hashing
- **Authorization:** Role-based middleware on every endpoint
- **Rate limiting:** 5 submissions/user/hour, 100 requests/min for public endpoints
- **Audit logging:** All sensitive operations logged (receipts, matches, role changes, moderation)
- **Append-only:** Database-level enforcement (REVOKE UPDATE/DELETE + triggers)
- **Data minimization:** Only collect what's needed; strip PII from exports

## Offline Architecture

```
┌─────────────────────────────────────────────┐
│              Browser (React)                 │
│                                              │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │  IndexedDB   │  │  Service Worker     │  │
│  │  (drafts)    │  │  (cache + sync)     │  │
│  └──────┬───────┘  └──────────┬──────────┘  │
│         │                     │              │
│         └─────────┬───────────┘              │
│                   │                          │
│         ┌─────────▼─────────┐                │
│         │  Online Listener  │                │
│         │  (flush drafts)   │                │
│         └───────────────────┘                │
└─────────────────────────────────────────────┘
```

## Performance

- **Frontend:** Compressed (gzip/brotli), minimal media, cached public content, no heavy libraries
- **Backend:** Connection pooling, query optimization, FTS indexing
- **Database:** Read replicas for public queries, write master for receipts/matches
- **CDN:** Static assets served via CDN where available

## Monitoring

- Application logs (structured JSON)
- Database query performance
- Hash chain integrity checks (periodic)
- Match review queue depth
- Submission rate anomalies
