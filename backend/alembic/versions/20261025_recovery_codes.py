"""Add self-service one-time offline password recovery codes."""
from alembic import op
import sqlalchemy as sa

revision = "20261025_recovery_codes"
down_revision = "20261025_auth_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("recovery_codes_generated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "password_recovery_codes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash", name="uq_password_recovery_codes_code_hash"),
    )
    op.create_index("ix_password_recovery_codes_user_id", "password_recovery_codes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_password_recovery_codes_user_id", table_name="password_recovery_codes")
    op.drop_table("password_recovery_codes")
    op.drop_column("users", "recovery_codes_generated_at")
