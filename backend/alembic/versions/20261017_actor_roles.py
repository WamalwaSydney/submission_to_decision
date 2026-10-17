"""Canonical human roles and automated match attribution."""
from alembic import op
import sqlalchemy as sa

revision = "20261017_actor_roles"
down_revision = "20261015_committees_messages"
branch_labels = None
depends_on = None


DROP_ROLE_CHECKS = """
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;
"""


def upgrade() -> None:
    # Drop the old role constraint before inserting new role values.
    op.execute(sa.text(DROP_ROLE_CHECKS))

    # Convert legacy roles to the canonical role model.
    op.execute(sa.text(
        "UPDATE users SET role = 'citizen' "
        "WHERE role IN ('representative', 'researcher')"
    ))
    op.execute(sa.text(
        "UPDATE users SET role = 'committee_officer' "
        "WHERE role IN ('committee', 'clerk')"
    ))
    op.execute(sa.text(
        "UPDATE users SET role = 'reviewer' "
        "WHERE role = 'moderator'"
    ))

    # Enforce the new role model.
    op.execute(sa.text(
        "ALTER TABLE users ADD CONSTRAINT users_role_check "
        "CHECK (role IN "
        "('citizen', 'committee_officer', 'reviewer', 'administrator'))"
    ))

    # Mark generated matches as coming from the automated system.
    op.add_column(
        "submission_matches",
        sa.Column(
            "actor_type",
            sa.String(length=30),
            nullable=False,
            server_default="automated_system",
        ),
    )


def downgrade() -> None:
    op.drop_column("submission_matches", "actor_type")

    op.execute(sa.text(
        "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check"
    ))

    # Lossy conversion: original role identity cannot be reconstructed.
    op.execute(sa.text(
        "UPDATE users SET role = 'committee' "
        "WHERE role = 'committee_officer'"
    ))
    op.execute(sa.text(
        "UPDATE users SET role = 'moderator' "
        "WHERE role = 'reviewer'"
    ))

    op.execute(sa.text(
        "ALTER TABLE users ADD CONSTRAINT users_role_check "
        "CHECK (role IN "
        "('citizen','representative','committee',"
        "'moderator','administrator','clerk'))"
    ))
