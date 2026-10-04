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
