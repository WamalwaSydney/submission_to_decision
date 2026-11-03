"""Record where each bill's committee assignment came from."""
from alembic import op
import sqlalchemy as sa

revision = "20261103_committee_source"
down_revision = "20261103_submission_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("legislative_items", sa.Column("committee_assignment_source", sa.String(30), nullable=True))
    # Assignments made before this column came from official sources
    # (committee sponsors, calls for memoranda, or committee secretariats).
    op.execute("UPDATE legislative_items SET committee_assignment_source = 'official record' WHERE committee_id IS NOT NULL")


def downgrade() -> None:
    op.drop_column("legislative_items", "committee_assignment_source")
