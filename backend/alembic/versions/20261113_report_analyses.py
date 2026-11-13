"""Store Gemini's reading of each committee report (submissions recorded and decisions)."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261113_report_analyses"
down_revision = "20261106_notice_per_bill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_ref", postgresql.UUID(as_uuid=True), sa.ForeignKey("committee_reports.id"), nullable=False, unique=True),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("entries_analysed", sa.Integer, nullable=False, server_default="0"),
        sa.Column("items", sa.JSON, nullable=False),
        sa.Column("summary", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("report_analyses")
