# Production database cleanup runbook

## Safety boundary

No production connection was available or used while implementing this change. Do not treat this runbook as authorization to remove user or participation data. Any business-data deletion requires a separately reviewed exact scope, retention/legal approval, restore-tested backup, and explicit approval for the target environment.

The new Alembic migration is additive. It adds `users.auth_version` and `password_reset_tokens`; it does not delete, truncate, or rewrite existing accounts, submissions, audit records, bills, or committee data. Apply it only after confirming the target database and backup/PITR position.

## Preflight

1. Confirm database hostname, database name, environment, and deployment revision from trusted deployment configuration. Do not print credentials into logs or shell history.
2. Confirm a recent managed backup and successful restore test; record the restore point / backup identifier.
3. Check migration state and capture row counts for critical tables (`users`, `participation_receipts`, `audit_log`, `legislative_items`, `committee_reports`).
4. Run the application chain verifier before and after the migration. Save the result and investigate any existing sequence/hash failures before proceeding.
5. Review retention policy and legal holds. Never clean up receipt/audit rows as routine housekeeping: they are append-only records.
6. Apply `alembic upgrade head` using a restricted migration identity during an approved maintenance window; then validate health, auth, signup, reset email delivery, and receipt append/verification.

## Routine auth-token housekeeping

Password reset tokens contain only a SHA-256 digest; used/expired rows may be pruned after an approved retention interval. Run this only after checking count and oldest/newest timestamps. The following is a pattern, not a pre-authorized production command; use small batches and the correct database role:

```sql
SELECT count(*) AS eligible_count
FROM password_reset_tokens
WHERE (used_at IS NOT NULL AND used_at < now() - interval '30 days')
   OR expires_at < now() - interval '30 days';
```

If approved, delete in bounded batches (repeat until no rows are returned), recording counts:

```sql
WITH doomed AS (
  SELECT id
  FROM password_reset_tokens
  WHERE (used_at IS NOT NULL AND used_at < now() - interval '30 days')
     OR expires_at < now() - interval '30 days'
  ORDER BY created_at
  LIMIT 500
)
DELETE FROM password_reset_tokens t
USING doomed
WHERE t.id = doomed.id;
```

## Data cleanup requests

Before removing or correcting any application data, provide: exact table(s) and row-selection criteria, purpose, expected row count, whether user data is involved, retention/legal approval, backup identifier, rollback/restore plan, and an approved maintenance window. Prefer reversible quarantine or archival over deletion. Do not disable append-only triggers to make cleanup easier. A privileged database operator can bypass database-level protections, so publish signed chain-head checkpoints outside the database to an independently administered immutable system for production-grade tamper evidence.

## Administrator-assisted password recovery

Password recovery does not depend on SMTP. An administrator must independently verify the account holder before selecting **Recovery link** in the user directory. The backend stores only the token digest, invalidates any prior unused code, records issuance in `audit_log` without recording the secret, and returns the raw link once to the authorized administrator. The link expires after 30 minutes and can be used once. Deliver it only through the already-verified channel; do not rely on the account email unless that address has been independently verified. If no trusted identity-verification process exists, do not issue a recovery link.


## User-managed recovery codes

The self-service recovery path uses offline recovery codes and requires no SMTP dependency. Signed-in users open **Account Security**, re-enter their current password, then securely save the displayed one-time codes. The database stores only SHA-256 digests. A successful recovery invalidates the entire code set and all prior access tokens; the user must sign in and issue a fresh set. Roll this out with user instructions encouraging password-manager or printed offline storage. Existing accounts need to generate their own set before they can use self-service recovery.

The latest recovery-code migration is `20261025_recovery_codes`, after `20261025_auth_hardening`. Apply the full Alembic head before releasing the updated frontend/backend pair. For existing accounts, communicate enrollment in advance: an account cannot use self-service reset until its owner has generated and safely stored codes. Accounts that lose both their password and unused recovery codes still require the separately controlled administrator identity-verification fallback.
