# Database Schema

## Overview

PostgreSQL 15+ with UUID primary keys and append-only enforcement via triggers. The schema is managed by Alembic (`backend/alembic/versions/`); the SQL below summarises it. Where this summary and a migration differ, the migration is authoritative.

## Tables

### users
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(20) NOT NULL,  -- citizen | committee_officer | reviewer (moderator) | administrator
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    privacy_prefs JSONB DEFAULT '{"show_name_publicly": false}',
    status VARCHAR(20) DEFAULT 'active',  -- active | suspended | pending_approval
    committee_id UUID REFERENCES committees(id),  -- Clerk's Office accounts: the one committee they may manage
    auth_version INTEGER NOT NULL DEFAULT 0,
    recovery_codes_generated_at TIMESTAMPTZ,
    created_date TIMESTAMPTZ DEFAULT NOW()
);
```

A Clerk's Office (`committee_officer`) account signs up for one committee of one legislature and stays `pending_approval` until an administrator approves it. It can only act on bills assigned to that committee.

### committees
```sql
CREATE TABLE committees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,   -- county committees carry their county, e.g. "Health Services (Nairobi)"
    institution VARCHAR(100) NOT NULL,   -- National Assembly | Nairobi City County Assembly | Trans Nzoia County Assembly
    description TEXT,
    contact_email VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

National Assembly committees come from the Parliament sync. County committees are created by `app.committee_assignment.ensure_county_committees` from each assembly's published committee list.

### representative_profiles
```sql
CREATE TABLE representative_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    office VARCHAR(255) NOT NULL,
    jurisdiction VARCHAR(255) NOT NULL,
    institution VARCHAR(100) NOT NULL CHECK (institution IN ('National Assembly', 'Nairobi County Assembly', 'Trans Nzoia County Assembly')),
    committee_membership TEXT[] DEFAULT '{}',
    verification_status VARCHAR(30) DEFAULT 'unclaimed' CHECK (verification_status IN ('unclaimed', 'verified and active', 'verified but inactive')),
    profile_label VARCHAR(20) DEFAULT 'unclaimed' CHECK (profile_label IN ('verified', 'pilot', 'simulated', 'unclaimed')),
    verifier_id UUID REFERENCES users(id),
    contact_channels JSONB DEFAULT '[]',
    created_date TIMESTAMPTZ DEFAULT NOW()
);
```

### legislative_items
```sql
CREATE TABLE legislative_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    identifier VARCHAR(100) UNIQUE NOT NULL,
    institution VARCHAR(100) NOT NULL,
    stage VARCHAR(100) NOT NULL,
    documents JSONB DEFAULT '[]', -- source URL or stored document metadata
    status_history JSONB DEFAULT '[]',
    is_simulated BOOLEAN DEFAULT false,
    bill_house VARCHAR(20),
    bill_number INTEGER,
    bill_year INTEGER,
    source_url VARCHAR(1000),
    source_file_ref VARCHAR(255),
    source_updated_at DATE,
    source_status VARCHAR(100),
    committee_id UUID REFERENCES committees(id),
    committee_assignment_source VARCHAR(30)  -- official record | subject matter | administrator
);
```

`bill_house` is `na`, `senate`, `ncca` (Nairobi City County Assembly) or `tnca` (Trans Nzoia County Assembly). County identifiers look like `NCCA/2025/Bill-004`. `status_history` holds dated stages parsed from the Bills Tracker (Published, First Reading, Second Reading, Committee of the Whole House, Third Reading, Assented) or, for counties, the assembly listing and the Kenya Law Act.

`committee_assignment_source` records where the committee came from: an official source (`official record`), a subject-matter suggestion from the bill title awaiting confirmation (`subject matter`), or an administrator (`administrator`). The sync never overwrites an administrator's choice.

### participation_receipts (APPEND-ONLY)
```sql
CREATE TABLE participation_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id VARCHAR(20) UNIQUE NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id),
    legislative_item_id UUID NOT NULL REFERENCES legislative_items(id),
    clause_ref VARCHAR(100),
    submission_text TEXT NOT NULL,
    lodging_status VARCHAR(20) DEFAULT 'pending' CHECK (lodging_status IN ('pending', 'lodged', 'acknowledged', 'not_applicable')),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hash VARCHAR(64) NOT NULL,
    previous_hash VARCHAR(64) NOT NULL,
    chain_sequence BIGINT NOT NULL UNIQUE,  -- position in the chain
    author_name_public VARCHAR(255),
    revision INTEGER NOT NULL DEFAULT 1,     -- 1 for a new submission, 2+ for each edit
    submission_ref VARCHAR(20),              -- for revision 2+: the citizen's original receipt ID
    attachment_name VARCHAR(255),            -- optional uploaded memorandum (PDF, .docx, .txt)
    attachment_mime_type VARCHAR(100),
    attachment_size_bytes BIGINT,
    attachment_sha256 VARCHAR(64),           -- included in the receipt hash when present
    attachment_storage_ref VARCHAR(1000)     -- never sent to the browser
);

-- Append-only enforcement (migration 20261012_integrity_provenance)
CREATE OR REPLACE FUNCTION prevent_append_only_modification() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only and cannot be modified or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_receipt_prevent_update BEFORE UPDATE ON participation_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification();
CREATE TRIGGER trg_receipt_prevent_delete BEFORE DELETE ON participation_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification();
```

**Edits never change a row.** A citizen has one submission per bill. Editing it inserts a new row with `public_id = "<ID>-v<n>"`, `submission_ref = "<ID>"` and `revision = n`; the earlier row is untouched. The current version of a submission is the row with the highest revision for `coalesce(submission_ref, public_id)` (see `receipt_service.is_current`). Public pages show the citizen's original ID; earlier versions are looked up as `<ID>-v1`, `<ID>-v2`, and so on.

**Receipt hash input:** receipt ID, author ID, bill ID, clause reference, submission text, timestamp and previous hash, plus `attachment_sha256` when a document is attached. Receipts without a document keep the original hash format.

### committee_reports
```sql
CREATE TABLE committee_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_ref UUID NOT NULL REFERENCES legislative_items(id),
    institution VARCHAR(100) NOT NULL,
    date_tabled DATE NOT NULL,
    source_document_ref VARCHAR(500) NOT NULL,
    extraction_status VARCHAR(20) DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'extracted', 'ocr_used', 'needs_review', 'verified')),
    ocr_used BOOLEAN DEFAULT false,
    is_simulated BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### report_entries
```sql
CREATE TABLE report_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_ref UUID NOT NULL REFERENCES committee_reports(id),
    clause_ref VARCHAR(100) NOT NULL,
    extracted_summary TEXT NOT NULL,
    treatment VARCHAR(30) NOT NULL CHECK (treatment IN ('adopted', 'amended', 'rejected with reasons', 'not addressed')),
    stated_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### submission_matches
```sql
CREATE TABLE submission_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_ref UUID NOT NULL REFERENCES participation_receipts(id),
    report_entry_ref UUID NOT NULL REFERENCES report_entries(id),
    match_method VARCHAR(20) NOT NULL,  -- llm | clause | text-similarity
    confidence_score FLOAT NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    explanation TEXT NOT NULL,
    reviewer_decision VARCHAR(20) DEFAULT 'pending',  -- pending | confirmed | rejected | superseded (the submission was edited)
    reviewer_reason TEXT,                             -- required when rejecting
    reviewer_id UUID REFERENCES users(id),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_matches_pending ON submission_matches (reviewer_decision) WHERE reviewer_decision = 'pending';
CREATE INDEX idx_matches_confirmed ON submission_matches (reviewer_decision) WHERE reviewer_decision = 'confirmed';
```

### notice_records
```sql
CREATE TABLE notice_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_ref UUID NOT NULL REFERENCES legislative_items(id),
    institution VARCHAR(100) NOT NULL,
    notice_date DATE NOT NULL,
    window_start DATE NOT NULL,
    window_end DATE NOT NULL,
    mode VARCHAR(255) NOT NULL,
    bill_text_accessible BOOLEAN DEFAULT false,
    source_url VARCHAR(1000),
    source_title VARCHAR(500),
    committee_name VARCHAR(255),
    published_date DATE
);
```

`bill_text_accessible` records whether the bill text was available alongside the published notice. When true, the UI links to the bill's Documents section. A document entry may contain a validated external `url`, or uploaded-file metadata such as `storage_ref`, `mime_type`, `sha256`, and `size_bytes`; stored files are served through `GET /api/v1/bills/{bill_id}/documents/{document_index}` rather than exposing filesystem paths.

Notice edits update the existing row through `PUT /api/v1/notices/{notice_id}`; they do not create a duplicate notice record. The API validates that the bill is a live non-simulated legislative item, that the institution belongs to the active platform institution set, and that a Clerk's Office account only records notices for its own committee's bills. A notice's window decides when the bill accepts submissions (`backend/app/participation.py`).

### moderation_actions
```sql
CREATE TABLE moderation_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES users(id),
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('receipt', 'profile', 'report_entry')),
    content_id UUID NOT NULL,
    reason TEXT NOT NULL,
    decision VARCHAR(20) DEFAULT 'pending' CHECK (decision IN ('pending', 'upheld', 'dismissed')),
    moderator_id UUID REFERENCES users(id),
    appeal_status VARCHAR(20) DEFAULT 'none' CHECK (appeal_status IN ('none', 'appealed', 'resolved')),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
```

### audit_log (APPEND-ONLY)
```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL,
    details TEXT NOT NULL,
    actor_id UUID REFERENCES users(id),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Same triggers as participation_receipts:
-- trg_audit_prevent_update / trg_audit_prevent_delete → prevent_append_only_modification()
```

## Indexes

```sql
-- Foreign key indexes
CREATE INDEX idx_receipts_author ON participation_receipts (author_id);
CREATE INDEX idx_receipts_bill ON participation_receipts (legislative_item_id);
CREATE INDEX idx_reports_bill ON committee_reports (bill_ref);
CREATE INDEX idx_entries_report ON report_entries (report_ref);
CREATE INDEX idx_matches_receipt ON submission_matches (receipt_ref);
CREATE INDEX idx_matches_entry ON submission_matches (report_entry_ref);
CREATE INDEX idx_notices_bill ON notice_records (bill_ref);
CREATE INDEX idx_profiles_user ON representative_profiles (user_id);

-- Status indexes
CREATE INDEX idx_receipts_status ON participation_receipts (lodging_status);
CREATE INDEX idx_reports_status ON committee_reports (extraction_status);
CREATE INDEX idx_profiles_status ON representative_profiles (verification_status);
```

## Constraints Summary

| Table | Constraint | Type |
|---|---|---|
| participation_receipts | Append-only (edits are new rows) | TRIGGER |
| participation_receipts | Unique `public_id`, unique `chain_sequence` | UNIQUE |
| audit_log | Append-only | TRIGGER |
| committees | Unique `name` | UNIQUE |
| legislative_items | Unique `identifier` | UNIQUE |

## Migrations

Apply all migrations with `alembic upgrade head`. With Docker Compose, run it inside the backend container, where the database host `postgres` resolves:

```bash
docker compose exec backend alembic upgrade head
```

| Revision | Adds |
|---|---|
| `20261005_150300` | Legislation sync tables and bill source fields |
| `20261012_integrity_provenance` | Report provenance, `chain_sequence`, append-only triggers on receipts and audit log |
| `20261015_committees_messages` | Committees, messages, role cleanup |
| `20261017_actor_roles`, `20261017_reviewer_attribution` | Audit actors, reviewer attribution |
| `20261018_ai_notifications` | Automated bilingual notifications |
| `20261025_auth_hardening`, `20261025_recovery_codes` | Token versioning, password reset, recovery codes |
| `20261026_match_reviewer_reason`, `20261026_confirmed_match_lodging` | Rejection reasons, lodging derived from confirmed matches |
| `20261103_submission_revisions` | Receipt `revision`, `submission_ref` and uploaded-document columns (added without rewriting rows, so the append-only triggers are not fired) |
| `20261103_committee_source` | `legislative_items.committee_assignment_source`; existing assignments marked `official record` |

A database created by `python -m app.seed` (which calls `create_all`) has the tables but **not** the append-only triggers. Production uses the migrations; for a seeded local database, stamp it (`alembic stamp 20261026_confirmed_match_lodging`), upgrade, and install the triggers from `20261012_integrity_provenance` so local behaviour matches production. The test suite installs the same triggers.

## Backup Strategy

- Daily automated backups (pg_dump)
- WAL archiving for point-in-time recovery
- Read replicas for public queries
- Write master for receipts/matches

## Current implementation note

Migration `20261012_integrity_provenance` adds report checksum/storage/provenance fields, deterministic receipt sequence numbers, actor IDs for audit events, and PostgreSQL triggers that reject updates/deletes on `participation_receipts` and `audit_log`. Apply it with `alembic upgrade head` before using the new fields. `REPORT_STORAGE_DIR` must point to persistent storage in deployment; the default local directory is suitable only for development or a persistent mounted volume.

## Production change and cleanup policy

Production changes are schema-first and non-destructive: deploy a verified backup/PITR point, run `alembic upgrade head` using a dedicated migration identity, then deploy the compatible application. Never use `drop_all`, reset scripts, or ad-hoc table truncation against production. The auth-hardening migration adds `users.auth_version` and `password_reset_tokens`; it does not remove or rewrite account or participation data. Expired/used reset tokens may be pruned by a scheduled retention job after the retention window, in bounded batches. Confirm backup restore tests, migration status, duplicate/null diagnostics, and row counts before any separately authorized data remediation.

Receipt verification now also checks contiguous sequence numbers. The database advisory transaction lock serializes append operations and append-only triggers block ordinary updates/deletes. This is tamper-evident within the database, not protection against a privileged database owner: production deployments should periodically publish signed chain-head checkpoints to an independently administered immutable store and retain offsite backups. Never claim the chain is cryptographically immutable against a fully privileged operator without such external anchoring.

## Password reset and credentials

Configure `JWT_SECRET_KEY` with a unique high-entropy secret and `APP_ENV=production`. Primary password recovery uses one-time offline recovery codes generated by the signed-in user after re-entering their current password. The database stores only code digests; each code has 128 bits of randomness and is single use. A successful recovery consumes the whole issued set and increments `auth_version` to invalidate existing access tokens, after which the user signs in and generates a new set. Users must store codes securely offline; they are shown only once. Administrator-assisted recovery remains an exceptional fallback and requires identity verification through a separately trusted process. Keep real secrets out of `.env.example`, source control, and logs.

Migration `20261025_recovery_codes` adds `password_recovery_codes` and the nullable enrollment timestamp `users.recovery_codes_generated_at`. Apply all migrations with `alembic upgrade head` before deploying the matching backend. Existing accounts start without recovery codes; ask every user to sign in, visit **Account Security**, re-enter their current password, and securely store their codes before depending on self-service recovery. New signups and accounts that sign in without enrollment are routed to the setup page. SMTP is not required for this recovery path.
