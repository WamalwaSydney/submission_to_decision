"""Rename moderation attribution to independent reviewer."""
from alembic import op
import sqlalchemy as sa

revision = "20261017_reviewer_attribution"
down_revision = "20261017_actor_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('moderation_actions', 'moderator_id', new_column_name='reviewer_id')


def downgrade() -> None:
    op.alter_column('moderation_actions', 'reviewer_id', new_column_name='moderator_id')
