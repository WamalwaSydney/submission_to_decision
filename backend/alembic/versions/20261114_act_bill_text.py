"""Make sure act_traces has bill_text.

The column was added to 20261113_act_traces after some databases (production) had already run it,
so they never got it. IF NOT EXISTS makes this safe on databases that already have it.
"""
from alembic import op

revision = "20261114_act_bill_text"
down_revision = "20261114_report_submitters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE act_traces ADD COLUMN IF NOT EXISTS bill_text TEXT")


def downgrade() -> None:
    pass  # the column belongs to 20261113_act_traces; removing it here would break databases created from that
