"""Link bills to their final Act and trace committee recommendations into it."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261113_act_traces"
down_revision = "20261113_report_analyses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "act_traces",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("bill_ref", postgresql.UUID(as_uuid=True), sa.ForeignKey("legislative_items.id"), nullable=False, unique=True),
        sa.Column("act_title", sa.String(500)),
        sa.Column("act_citation", sa.String(100)),
        sa.Column("act_url", sa.String(1000)),
        sa.Column("storage_ref", sa.String(1000)),
        sa.Column("sha256", sa.String(64)),
        sa.Column("act_text", sa.Text),
        sa.Column("bill_text", sa.Text),
        sa.Column("model", sa.String(100)),
        sa.Column("items", sa.JSON, nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("act_traces")
