"""Store the human review reason for rejected submission matches."""
from alembic import op
import sqlalchemy as sa

revision = "20261026_match_reviewer_reason"
down_revision = "20261025_recovery_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("submission_matches", sa.Column("reviewer_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("submission_matches", "reviewer_reason")
