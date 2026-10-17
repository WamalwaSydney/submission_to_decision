"""Canonical human roles and automated match attribution."""
from alembic import op
import sqlalchemy as sa

revision = "20261017_actor_roles"
down_revision = "20261015_committees_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE users SET role = 'citizen' WHERE role IN ('representative', 'researcher')"))
    op.execute(sa.text("UPDATE users SET role = 'committee_officer' WHERE role IN ('committee', 'clerk')"))
    op.execute(sa.text("UPDATE users SET role = 'reviewer' WHERE role = 'moderator'"))
    op.execute(sa.text("""
      DO $$ DECLARE c RECORD; BEGIN
        FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid = 'users'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role%'
        LOOP EXECUTE format('ALTER TABLE users DROP CONSTRAINT IF EXISTS %I', c.conname); END LOOP;
      END $$;
    """))
    op.execute(sa.text("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('citizen','committee_officer','reviewer','administrator'))"))
    op.add_column('submission_matches', sa.Column('actor_type', sa.String(length=30), nullable=False, server_default='automated_system'))


def downgrade() -> None:
    op.drop_column('submission_matches', 'actor_type')
    op.execute(sa.text("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check"))
    op.execute(sa.text("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('citizen','representative','committee','moderator','administrator','clerk'))"))
