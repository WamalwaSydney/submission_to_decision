"""Seal submissions recorded in committee reports into the receipt hash chain.

report_records shares the chain with participation_receipts: one sequence and one chain head across both tables,
so existing receipts keep their hashes and positions. Rows are append-only, like receipts.
"""
from alembic import op

revision = "20261120_report_records"
down_revision = "20261114_act_bill_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS report_records (
            id UUID PRIMARY KEY,
            public_id VARCHAR(20) NOT NULL UNIQUE,
            report_ref UUID NOT NULL REFERENCES committee_reports(id),
            legislative_item_id UUID NOT NULL REFERENCES legislative_items(id),
            entry_key VARCHAR(100) NOT NULL,
            source VARCHAR(20) NOT NULL,
            stakeholder TEXT,
            clause_ref VARCHAR(255),
            issue TEXT NOT NULL,
            decision VARCHAR(30) NOT NULL,
            reason TEXT,
            report_sha256 VARCHAR(64),
            recorded_at TIMESTAMPTZ NOT NULL,
            hash VARCHAR(64) NOT NULL,
            previous_hash VARCHAR(64) NOT NULL,
            chain_sequence BIGINT NOT NULL UNIQUE,
            CONSTRAINT uq_report_record_entry UNIQUE (report_ref, entry_key)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_report_records_bill ON report_records(legislative_item_id)")
    # prevent_append_only_modification() was created by 20261012_integrity_provenance.
    op.execute("DROP TRIGGER IF EXISTS trg_record_prevent_update ON report_records")
    op.execute("DROP TRIGGER IF EXISTS trg_record_prevent_delete ON report_records")
    op.execute("CREATE TRIGGER trg_record_prevent_update BEFORE UPDATE ON report_records FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification()")
    op.execute("CREATE TRIGGER trg_record_prevent_delete BEFORE DELETE ON report_records FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification()")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS report_records")
