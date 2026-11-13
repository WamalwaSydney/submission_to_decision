"""Stakeholders each committee report says sent views."""
from alembic import op
import sqlalchemy as sa

revision = "20261114_report_submitters"
down_revision = "20261114_house_traces"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("report_analyses", sa.Column("submitters", sa.JSON))


def downgrade() -> None:
    op.drop_column("report_analyses", "submitters")
