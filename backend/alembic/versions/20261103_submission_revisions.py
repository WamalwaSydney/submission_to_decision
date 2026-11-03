"""Submission revisions and uploaded memorandum documents.

participation_receipts is append-only (triggers from 20261012_integrity_provenance
reject UPDATE and DELETE). An edit is therefore a new row: it carries the
citizen's original receipt ID in ``submission_ref`` and a higher ``revision``.
The current version of a submission is its highest revision; no row is ever
changed.
"""
from alembic import op
import sqlalchemy as sa

revision = "20261103_submission_revisions"
down_revision = "20261026_confirmed_match_lodging"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Adding columns with constant defaults does not rewrite rows, so the
    # append-only row triggers are not fired.
    op.add_column("participation_receipts", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("participation_receipts", sa.Column("submission_ref", sa.String(20), nullable=True))
    op.add_column("participation_receipts", sa.Column("attachment_name", sa.String(255), nullable=True))
    op.add_column("participation_receipts", sa.Column("attachment_mime_type", sa.String(100), nullable=True))
    op.add_column("participation_receipts", sa.Column("attachment_size_bytes", sa.BigInteger(), nullable=True))
    op.add_column("participation_receipts", sa.Column("attachment_sha256", sa.String(64), nullable=True))
    op.add_column("participation_receipts", sa.Column("attachment_storage_ref", sa.String(1000), nullable=True))
    op.create_index("ix_participation_receipts_submission_ref", "participation_receipts", ["submission_ref"])
    op.create_index("ix_participation_receipts_author_bill", "participation_receipts", ["author_id", "legislative_item_id"])


def downgrade() -> None:
    op.drop_index("ix_participation_receipts_author_bill", table_name="participation_receipts")
    op.drop_index("ix_participation_receipts_submission_ref", table_name="participation_receipts")
    for column in ("attachment_storage_ref", "attachment_sha256", "attachment_size_bytes", "attachment_mime_type", "attachment_name", "submission_ref", "revision"):
        op.drop_column("participation_receipts", column)
