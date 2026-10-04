# Implementation Decisions

This document records every choice made where the specification was silent on implementation details, plus open questions.

## Hash Chain

| Decision | Choice | Rationale |
|---|---|---|
| Hash algorithm | SHA-256 | Spec suggests it; widely supported, collision-resistant |
| Genesis hash | `0000...0000` (64 zeros) | Fixed, deterministic starting point for the chain |
| Canonical JSON | Sorted keys, no whitespace | Deterministic serialization for consistent hashing |
| Hash input fields | receipt_id, author_id, legislative_item_id, clause_ref, submission_text, timestamp, previous_hash | Covers all mutable receipt content |
| Public receipt ID format | `RCT-` prefix + 6 alphanumeric chars (no ambiguous chars like 0/O, 1/I) | Human-typeable, non-guessable |
| Chain serialization | Serialized transaction (lock chain head) | Prevents two receipts sharing the same previous_hash |

## Authentication

| Decision | Choice | Rationale |
|---|---|---|
| Password hashing | argon2id (backend), SHA-256 via Web Crypto (frontend demo) | Argon2 is memory-hard, resistant to GPU attacks |
| Session management | JWT with 1-hour expiry | Stateless, scalable; short expiry for security |
| Role enforcement | Middleware on every protected route | Least-privilege; prevents privilege escalation |

## Database

| Decision | Choice | Rationale |
|---|---|---|
| Primary keys | UUIDs (UUIDv4) | Spec requirement; avoids enumeration |
| Append-only enforcement | PostgreSQL REVOKE UPDATE/DELETE + trigger that raises on attempt | Stronger than application-level checks |
| Audit log | Separate table, append-only | Covers receipts, extractions, matches, claims, role changes, moderation |
| Edit history | Preserved on receipts, report entries, matches | Spec requirement (§1.7) |

## Matching Engine

| Decision | Choice | Rationale |
|---|---|---|
| Primary method | Clause-reference match (rule-based) | Exact, deterministic, high precision |
| Fallback method | rapidfuzz token_sort_ratio | Fast, explainable, no model dependency |
| Minimum confidence for auto-queue | 0.3 | Below this, matches are not even proposed |
| Explanation requirement | Every match includes method + confidence + human-readable explanation | Spec requirement (FR5) |

## Offline Mode

| Decision | Choice | Rationale |
|---|---|---|
| Storage | IndexedDB (drafts store) | Persistent, structured, works offline |
| Sync mechanism | `online` event listener + manual flush | Service Worker background sync not universally supported |
| What works offline | Read cached content, draft submissions, navigate screens | Spec requirement (FR10) |
| What does NOT work offline | Chain verification, new outcomes | Requires server connection |

## UI/UX

| Decision | Choice | Rationale |
|---|---|---|
| CSS framework | Tailwind CSS v4 | Utility-first, responsive, low bandwidth |
| Icons | lucide-react | Lightweight, tree-shakeable |
| Routing | React Router v6 (HashRouter) | Works with static file serving |
| Font | System font stack | No web font downloads; low bandwidth |
| Color scheme | Blue/gray with semantic status colors | WCAG AA contrast; accessible |
| Language | English only | Spec requirement; strings centralized for future Kiswahili |

## Content Labeling

| Decision | Choice | Rationale |
|---|---|---|
| Citizen content | Blue-tinted background | Visually distinct from other categories |
| Representative statements | Green-tinted background | Clearly labeled with verification status |
| System aggregates | Purple-tinted background | Computed, not user-editable |

## Export Formats

| Decision | Choice | Rationale |
|---|---|---|
| Research export | JSON + CSV | JSON for programmatic use, CSV for spreadsheet analysis |
| Anonymization | Strip author_id, reviewer_id, auth_data | Spec requirement (FR12) |
| Public export | Outcome trail + notice data | Available to journalists/researchers |

## Open Questions

1. **Lodging channel integration:** How to programmatically send memoranda to specific institution channels (email APIs, portal integrations)? Currently manual.
2. **OCR quality threshold:** What text coverage percentage triggers OCR fallback? Tentatively set at 10%.
3. **Appeal window duration:** Spec says appeals are supported but doesn't specify duration. Tentatively 14 days.
4. **Multi-language support timeline:** When will Kiswahili be added? Currently strings are centralized but no timeline.
5. **Scaling beyond pilot:** How to handle 47 counties? Schema supports it, but ingestion pipeline needs evaluation.
6. **Legal standing of receipts:** Courts have not ruled on platform-issued receipts. This is a research question.
7. **Representative response deadline:** Should there be a time limit for committee response? Not in spec.
8. **Data retention policy:** How long are audit logs kept? Indefinitely for integrity, but other data needs a schedule.
