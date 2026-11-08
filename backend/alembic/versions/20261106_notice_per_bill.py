"""One call-for-memoranda row per (notice page, bill).

A single Parliament notice often invites views on several bills. The old
unique index on source_url alone kept only one of them.
"""
from alembic import op

revision = "20261106_notice_per_bill"
down_revision = "20261103_committee_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_notice_source_url")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_source_bill ON notice_records(source_url, bill_ref) WHERE source_url IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_notice_source_bill")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_source_url ON notice_records(source_url) WHERE source_url IS NOT NULL")
