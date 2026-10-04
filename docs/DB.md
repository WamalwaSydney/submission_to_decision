# Database Schema

## Overview

PostgreSQL 15+ with UUID primary keys, full-text search, and append-only enforcement via triggers.

## Tables

### users
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(20) NOT NULL CHECK (role IN ('citizen', 'representative', 'researcher', 'moderator', 'administrator', 'clerk')),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    privacy_prefs JSONB DEFAULT '{"show_name_publicly": false}',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_date TIMESTAMPTZ DEFAULT NOW()
);
```

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
    documents JSONB DEFAULT '[]',
    status_history JSONB DEFAULT '[]',
    is_simulated BOOLEAN DEFAULT false,
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(identifier, ''))
    ) STORED
);

CREATE INDEX idx_legislative_items_search ON legislative_items USING GIN (search_vector);
```

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
    author_name_public VARCHAR(255)
);

-- Append-only enforcement
REVOKE UPDATE, DELETE ON participation_receipts FROM PUBLIC;

CREATE OR REPLACE FUNCTION prevent_receipt_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Receipts are append-only and cannot be modified or deleted';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_receipt_update
BEFORE UPDATE ON participation_receipts
FOR EACH ROW EXECUTE FUNCTION prevent_receipt_modification();

CREATE TRIGGER trg_prevent_receipt_delete
BEFORE DELETE ON participation_receipts
FOR EACH ROW EXECUTE FUNCTION prevent_receipt_modification();
```

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
    match_method VARCHAR(20) NOT NULL CHECK (match_method IN ('clause', 'text-similarity')),
    confidence_score FLOAT NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    explanation TEXT NOT NULL,
    reviewer_decision VARCHAR(20) DEFAULT 'pending' CHECK (reviewer_decision IN ('confirmed', 'rejected', 'pending')),
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
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

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
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only enforcement
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

CREATE TRIGGER trg_prevent_audit_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_receipt_modification();

CREATE TRIGGER trg_prevent_audit_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_receipt_modification();
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
| participation_receipts | Append-only | REVOKE + TRIGGER |
| audit_log | Append-only | REVOKE + TRIGGER |
| submission_matches | confidence_score 0-1 | CHECK |
| report_entries | treatment enum | CHECK |
| representative_profiles | verification_status enum | CHECK |
| users | role enum | CHECK |

## Migrations

Use Alembic for schema migrations:

```bash
cd backend
alembic init alembic
alembic revision --autogenerate -m "Initial schema"
alembic upgrade head
```

## Backup Strategy

- Daily automated backups (pg_dump)
- WAL archiving for point-in-time recovery
- Read replicas for public queries
- Write master for receipts/matches
