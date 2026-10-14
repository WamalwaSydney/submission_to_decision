"""Durable report provenance and database-level append-only protections."""
from alembic import op
import sqlalchemy as sa

revision = "20261012_integrity_provenance"
down_revision = "20261005_150300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table, column, definition in [
        ("committee_reports", "source_sha256", "VARCHAR(64)"),
        ("committee_reports", "source_mime_type", "VARCHAR(100)"),
        ("committee_reports", "source_size_bytes", "BIGINT"),
        ("committee_reports", "source_storage_ref", "VARCHAR(1000)"),
        ("committee_reports", "extracted_text", "TEXT"),
        ("committee_reports", "provenance", "JSONB DEFAULT '{}'::jsonb"),
        ("committee_reports", "uploaded_by", "UUID REFERENCES users(id)"),
        ("participation_receipts", "chain_sequence", "BIGINT"),
        ("audit_log", "actor_id", "UUID REFERENCES users(id)"),
    ]:
        op.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}"))
    op.execute(sa.text("""
        WITH numbered AS (
          SELECT id, row_number() OVER (ORDER BY timestamp ASC, id ASC) AS n
          FROM participation_receipts
        )
        UPDATE participation_receipts r SET chain_sequence = numbered.n
        FROM numbered WHERE r.id = numbered.id AND r.chain_sequence IS NULL
    """))
    op.execute(sa.text("ALTER TABLE participation_receipts ALTER COLUMN chain_sequence SET NOT NULL"))
    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_chain_sequence ON participation_receipts(chain_sequence)"))
    op.execute(sa.text("""
        CREATE OR REPLACE FUNCTION prevent_append_only_modification()
        RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION '% rows are append-only and cannot be modified or deleted', TG_TABLE_NAME;
        END;
        $$ LANGUAGE plpgsql
    """))
    for table, prefix in [("participation_receipts", "receipt"), ("audit_log", "audit")]:
        op.execute(sa.text(f"DROP TRIGGER IF EXISTS trg_{prefix}_prevent_update ON {table}"))
        op.execute(sa.text(f"DROP TRIGGER IF EXISTS trg_{prefix}_prevent_delete ON {table}"))
        op.execute(sa.text(f"CREATE TRIGGER trg_{prefix}_prevent_update BEFORE UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification()"))
        op.execute(sa.text(f"CREATE TRIGGER trg_{prefix}_prevent_delete BEFORE DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification()"))


def downgrade() -> None:
    for table, prefix in [("participation_receipts", "receipt"), ("audit_log", "audit")]:
        op.execute(sa.text(f"DROP TRIGGER IF EXISTS trg_{prefix}_prevent_update ON {table}"))
        op.execute(sa.text(f"DROP TRIGGER IF EXISTS trg_{prefix}_prevent_delete ON {table}"))
    for table, column in [("audit_log", "actor_id"), ("participation_receipts", "chain_sequence"),
                          ("committee_reports", "uploaded_by"), ("committee_reports", "provenance"),
                          ("committee_reports", "extracted_text"), ("committee_reports", "source_storage_ref"),
                          ("committee_reports", "source_size_bytes"), ("committee_reports", "source_mime_type"),
                          ("committee_reports", "source_sha256")]:
        op.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}"))
