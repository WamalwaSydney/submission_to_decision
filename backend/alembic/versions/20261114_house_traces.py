"""What the House did with each committee recommendation (Committee of the Whole House)."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261114_house_traces"
down_revision = "20261113_act_traces"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "house_traces",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("bill_ref", postgresql.UUID(as_uuid=True), sa.ForeignKey("legislative_items.id"), nullable=False, unique=True),
        sa.Column("sittings", sa.JSON, nullable=False),
        sa.Column("hansard_text", sa.Text),
        sa.Column("model", sa.String(100)),
        sa.Column("items", sa.JSON, nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("house_traces")
