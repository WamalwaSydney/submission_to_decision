# REST API Reference

Base URL: `http://localhost:8000/api/v1`

All endpoints require authentication except those marked **Public**.

## Authentication

### POST /auth/login
**Public** — Obtain JWT token.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "user": {
    "id": "uuid",
    "role": "citizen",
    "name": "Jane Citizen"
  }
}
```

### POST /auth/register
**Public** — Create citizen account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "Jane Citizen"
}
```

---

## Bills (Legislative Items)

### GET /bills
**Public** — List all tracked bills.

**Query params:**
- `institution` (optional): Filter by institution
- `stage` (optional): Filter by stage
- `search` (optional): Full-text search

**Response:**
```json
{
  "bills": [
    {
      "id": "uuid",
      "title": "Nairobi Urban Planning (Amendment) Bill, 2026",
      "identifier": "NA/2026/Bill-014",
      "institution": "National Assembly",
      "stage": "Committee Stage",
      "is_simulated": true
    }
  ]
}
```

### GET /bills/{id}
**Public** — Get bill details with outcome trail.

**Response:**
```json
{
  "id": "uuid",
  "title": "...",
  "identifier": "...",
  "institution": "National Assembly",
  "stage": "Committee Stage",
  "documents": [{"name": "Bill Text", "url": "..."}],
  "status_history": [...],
  "outcome_counts": {
    "awaiting committee report": 3,
    "adopted": 2,
    "amended": 1,
    "rejected with reasons": 0,
    "not addressed": 1
  },
  "total_submissions": 7
}
```

---

## Receipts (Participation)

### POST /receipts
**Citizen** — Submit a view and receive a receipt.

**Request:**
```json
{
  "legislative_item_id": "uuid",
  "clause_ref": "Clause 4",
  "submission_text": "The proposed zoning changes...",
  "show_name_publicly": false
}
```

**Response:**
```json
{
  "receipt_id": "uuid",
  "public_id": "RCT-KN8X2M",
  "timestamp": "2026-02-05T10:30:00Z",
  "status": "awaiting committee report",
  "hash": "abc123...",
  "previous_hash": "def456..."
}
```

### GET /receipts/{public_id}
**Public** — Look up receipt by public ID.

**Response:**
```json
{
  "public_id": "RCT-KN8X2M",
  "legislative_item_id": "uuid",
  "bill_title": "Nairobi Urban Planning (Amendment) Bill, 2026",
  "clause_ref": "Clause 4",
  "submission_text": "...",
  "timestamp": "2026-02-05T10:30:00Z",
  "status": "awaiting committee report",
  "lodging_status": "pending",
  "hash": "abc123...",
  "match": {
    "method": "clause",
    "confidence": 0.95,
    "explanation": "...",
    "treatment": "amended",
    "stated_reason": "..."
  }
}
```

### GET /receipts/verify
**Public** — Verify entire hash chain.

**Response:**
```json
{
  "valid": true,
  "total_checked": 100,
  "first_broken_index": null,
  "details": [...]
}
```

### GET /receipts/my
**Citizen** — List own receipts.

---

## Reports (Ingestion)

### POST /reports/upload
**Clerk** — Upload committee report PDF.

**Request:** `multipart/form-data`
- `file`: PDF file
- `bill_ref`: Bill UUID
- `institution`: Institution name

**Response:**
```json
{
  "report_id": "uuid",
  "extraction_status": "pending",
  "ocr_used": false
}
```

### GET /reports/{id}
**Clerk, Moderator, Admin** — Get report with entries.

### PUT /reports/{id}/entries/{entry_id}
**Clerk** — Update report entry (clerk verification/correction).

**Request:**
```json
{
  "treatment": "amended",
  "stated_reason": "Committee agreed to expand eligibility..."
}
```

### PUT /reports/{id}/verify
**Clerk** — Mark report as verified.

---

## Matches (Linking)

### GET /matches/pending
**Moderator** — List pending match reviews.

**Response:**
```json
{
  "matches": [
    {
      "id": "uuid",
      "receipt": {
        "public_id": "RCT-KN8X2M",
        "submission_text": "...",
        "clause_ref": "Clause 4",
        "bill_title": "..."
      },
      "report_entry": {
        "clause_ref": "Clause 4",
        "extracted_summary": "...",
        "treatment": "amended"
      },
      "match_method": "clause",
      "confidence_score": 0.95,
      "explanation": "Exact clause reference match..."
    }
  ]
}
```

### POST /matches/{id}/confirm
**Moderator** — Confirm a proposed match.

### POST /matches/{id}/reject
**Moderator** — Reject a proposed match.

### GET /matches/confirmed
**Public** — List confirmed matches (for outcome trail).

---

## Notices

### GET /notices
**Public** — List all notice records.

### POST /notices
**Clerk, Admin** — Create notice record.

**Request:**
```json
{
  "bill_ref": "uuid",
  "institution": "Nairobi County Assembly",
  "notice_date": "2026-03-01",
  "window_start": "2026-03-01",
  "window_end": "2026-03-21",
  "mode": "Newspaper + public baraza",
  "bill_text_accessible": true
}
```

---

## Profiles

### GET /profiles
**Public** — List representative profiles.

### GET /profiles/{id}
**Public** — Get profile details.

### POST /profiles/{id}/claim
**Representative** — Claim an unclaimed profile.

### POST /profiles/{id}/verify
**Admin** — Verify a claimed profile.

**Request:**
```json
{
  "status": "verified and active"
}
```

### PUT /profiles/{id}
**Representative (own profile only)** — Update contact channels.

---

## Moderation

### POST /reports/content
**Citizen, Representative** — Report content.

**Request:**
```json
{
  "content_type": "receipt",
  "content_id": "uuid",
  "reason": "Suspected impersonation..."
}
```

### GET /moderation/cases
**Moderator** — List reported content cases.

### PUT /moderation/cases/{id}
**Moderator** — Update case decision.

**Request:**
```json
{
  "decision": "upheld"
}
```

### POST /moderation/cases/{id}/appeal
**Citizen** — Appeal a moderation decision.

---

## Exports

### GET /export/outcomes
**Researcher, Journalist** — Export outcome trail (JSON/CSV).

### GET /export/notices
**Researcher, Journalist** — Export notice data (JSON/CSV).

### GET /export/anonymized
**Admin** — Export anonymized dataset (JSON).

---

## Search

### GET /search
**Public** — Full-text search across people, legislation, outcomes.

**Query params:**
- `q`: Search query
- `type`: `people` | `legislation` | `outcomes` (optional)

---

## Error Responses

All errors follow this format:

```json
{
  "detail": "Error message",
  "code": "ERROR_CODE"
}
```

Common codes:
- `UNAUTHORIZED`: Missing or invalid authentication
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `VALIDATION_ERROR`: Invalid request data
- `RATE_LIMITED`: Too many requests
- `CHAIN_BROKEN`: Hash chain integrity compromised
