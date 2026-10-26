"""Reserve a migration version for derived acknowledged lodging status.

Participation receipts are append-only. The application derives "acknowledged"
from a confirmed match instead of updating receipt rows.
"""

revision = "20261026_confirmed_match_lodging"
down_revision = "20261026_match_reviewer_reason"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Intentionally no SQL: participation_receipts is append-only.
    pass


def downgrade() -> None:
    # No schema or data changes were made.
    pass
