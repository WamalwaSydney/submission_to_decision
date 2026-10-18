"""Persist bilingual, event-deduplicated notification metadata."""
from alembic import op
import sqlalchemy as sa

revision = "20261018_ai_notifications"
down_revision = "20261017_reviewer_attribution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("event_key", sa.String(length=255), nullable=True))
    op.add_column("messages", sa.Column("language", sa.String(length=2), nullable=False, server_default="en"))
    op.add_column("messages", sa.Column("generation_source", sa.String(length=20), nullable=False, server_default="template"))
    op.add_column("messages", sa.Column("source_snapshot", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    op.add_column("messages", sa.Column("delivery_status", sa.String(length=20), nullable=False, server_default="delivered"))
    op.create_unique_constraint("uq_messages_event_key", "messages", ["event_key"])


def downgrade() -> None:
    op.drop_constraint("uq_messages_event_key", "messages", type_="unique")
    op.drop_column("messages", "delivery_status")
    op.drop_column("messages", "source_snapshot")
    op.drop_column("messages", "generation_source")
    op.drop_column("messages", "language")
    op.drop_column("messages", "event_key")
