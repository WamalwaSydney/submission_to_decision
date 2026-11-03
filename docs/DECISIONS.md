# Implementation Decisions

This document records every choice made where the specification was silent on implementation details, plus open questions.

## Hash Chain

| Decision | Choice | Rationale |
|---|---|---|
| Hash algorithm | SHA-256 | Spec suggests it; widely supported, collision-resistant |
| Genesis hash | `0000...0000` (64 zeros) | Fixed, deterministic starting point for the chain |
| Canonical JSON | Sorted keys, no whitespace | Deterministic serialization for consistent hashing |
| Hash input fields | receipt_id, author_id, legislative_item_id, clause_ref, submission_text, timestamp, previous_hash, plus attachment_sha256 when a document is attached | Covers all receipt content; receipts without documents keep the original hash format |
| Editing a submission | A new chain entry (`<ID>-v2`, …) that records the original receipt ID; no row is ever updated | The database rejects UPDATE/DELETE on receipts; the citizen keeps one receipt ID and earlier versions stay verifiable |
| One submission per bill | Checked inside the chain's advisory lock | Two concurrent requests cannot both create a submission |
| Seed data | Seed receipts are hashed and linked like real receipts | Earlier seed data used placeholder hashes, so every seeded database failed verification |
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
| Proposal generator | Gemini (`gemini-2.5-flash-lite`) with a JSON schema | Understands paraphrase; never decides an outcome |
| Untrusted citizen text | Rules in the system instruction; text passed as data; instruction-like submissions flagged and capped at 0.5; unsupported scores capped at 0.6 | Limits prompt injection; moderators see the warning |
| Minimum proposal score | 0.5 | Below this, no proposal is created |
| Explanation requirement | Every match includes method + confidence + human-readable explanation | Spec requirement (FR5) |
| Who decides | A moderator confirms or rejects every proposal | Human judgement is final |
| Rejected proposal | The submission shows "Not addressed in the report" | A moderator rejecting a link is not the committee rejecting the view |
| When processing runs | A background worker in the API, a few bills every 10 minutes | Page views by anonymous visitors must not trigger OCR or AI calls |

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
| Color scheme | Kenyan flag palette: black, red (primary actions), green (success/open), white; gold for focus | National identity; consistent across MUI and Tailwind (`src/theme.ts`, `src/index.css`) |
| Home page | A different home page per role | Visitors, citizens, Clerk's Office staff, moderators and administrators need different next actions |
| Status wording | One journey: Received → With the committee → Report published → Response under review → Outcome | The old single "awaiting committee report" label was wrong once a report was out |
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
| Public export | Outcome trail + notice data | Available to all public users |
| Notice bill picker | Only the Clerk's Office account's own committee's bills (administrators: all) | A committee must not record or edit another committee's call for views |
| Notice institutions | Active platform institutions | Populate choices from active committees and live bill institutions, then validate server-side |
| Bill text accessibility | Actionable document link | A true accessibility flag links users to the bill Documents section; stored uploads are served through a safe API route |

## Public participation rules

| Decision | Choice | Rationale |
|---|---|---|
| Where tracing stops | The committee report | It is the legislature's formal record of what it heard from the public; later House stages are about the committee's recommendations, not individual views |
| When views are accepted | A recorded call for memoranda decides; otherwise First Reading only; Second Reading onwards is closed | National Assembly Standing Order 127: the committee takes views between First and Second Reading |
| Assented or closed bills | Submissions refused by the API | Prevents views that can no longer be considered |
| Uploaded memoranda | PDF, .docx or .txt up to 10 MB; text public, original file restricted to author and staff | Memoranda often carry signatures and contact details |

## Legislation data

| Decision | Choice | Rationale |
|---|---|---|
| National Assembly stages | Official Bills Tracker columns (published, readings, assent) and remarks | The proposals tracker alone left many bills at stale stages |
| Bill references | Accept "NA. Bill No." and "Sen. Bill No." | The tracker abbreviates the house with a full stop; 39% of rows were skipped before |
| Counties | Assembly bills pages plus Kenya Law Acts; stage shown as "Published by the assembly" until it is known | The assemblies do not publish bill stages online; no stage is invented |
| Committee assignment | Official evidence first; otherwise subject matter from the title, marked unconfirmed; administrators confirm | Parliament's trackers rarely state the committee |
| Scraped links | Only same-domain documents | The Trans Nzoia site has carried injected spam links |

## Access and abuse

| Decision | Choice | Rationale |
|---|---|---|
| Clerk's Office scope | One committee per account, enforced in the API and in the web client's data layer | A committee must not change outcomes on another committee's bills |
| Rate limits | In-memory: 100/min per IP, sign-in lockout, sign-up/reset limits | Promised in the design; prevents password guessing; Redis needed if scaled out |

## Open Questions

1. **Lodging channel integration:** How to programmatically send memoranda to the committee clerk (email or portal integration)? Currently manual, so "Not addressed" cannot yet prove the committee received a view.
2. **OCR quality threshold:** What text coverage percentage triggers OCR fallback? Tentatively set at 10%.
3. **Appeal window duration:** Spec says appeals are supported but doesn't specify duration. Tentatively 14 days.
4. **Multi-language support timeline:** Notifications are bilingual; the interface is still English-only.
5. **Scaling beyond pilot:** Two county assemblies are synced. Most assemblies do not publish bill stages or committee reports online, so Clerk's Office accounts must supply them.
9. **Production chain anchor:** The production database contains early seed receipts with placeholder hashes and one receipt whose stored hash no longer matches its content. Options: publish an audited checkpoint and verify from it, or rebuild every hash (not recommended). Awaiting a decision.
6. **Legal standing of receipts:** Courts have not ruled on platform-issued receipts. This is a research question.
7. **Representative response deadline:** Should there be a time limit for committee response? Not in spec.
8. **Data retention policy:** How long are audit logs kept? Indefinitely for integrity, but other data needs a schedule.
