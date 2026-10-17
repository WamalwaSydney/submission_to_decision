"""Add committees, committee-owned bills, committee users, and messages."""
from alembic import op
import sqlalchemy as sa

revision = "20261015_committees_messages"
down_revision = "20261012_integrity_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE users SET role = 'citizen' WHERE role = 'researcher'"))
    op.execute(sa.text("""
      DO $$ DECLARE c RECORD; BEGIN
        FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%researcher%'
        LOOP EXECUTE format('ALTER TABLE users DROP CONSTRAINT IF EXISTS %I', c.conname); END LOOP;
      END $$;
    """))
    op.execute(sa.text("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('citizen','representative','committee','moderator','administrator','clerk'))"))
    op.execute(sa.text("""
      CREATE TABLE IF NOT EXISTS committees (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        institution VARCHAR(100) NOT NULL,
        description TEXT,
        contact_email VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    """))
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS committee_id UUID REFERENCES committees(id)"))
    op.execute(sa.text("ALTER TABLE legislative_items ADD COLUMN IF NOT EXISTS committee_id UUID REFERENCES committees(id)"))
    op.execute(sa.text("""
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id UUID REFERENCES users(id),
        recipient_user_id UUID REFERENCES users(id),
        committee_id UUID REFERENCES committees(id),
        bill_id UUID REFERENCES legislative_items(id),
        receipt_id UUID REFERENCES participation_receipts(id),
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        message_type VARCHAR(40) NOT NULL DEFAULT 'general',
        sender_type VARCHAR(20) NOT NULL DEFAULT 'user',
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT message_target_check CHECK (recipient_user_id IS NOT NULL OR committee_id IS NOT NULL)
      )
    """))
    op.execute(sa.text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_type VARCHAR(20) NOT NULL DEFAULT 'user'"))
    op.execute(sa.text("ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_bills_committee ON legislative_items(committee_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_user_id, created_at DESC)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_messages_committee ON messages(committee_id, created_at DESC)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS messages"))
    op.execute(sa.text("ALTER TABLE legislative_items DROP COLUMN IF EXISTS committee_id"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS committee_id"))
    op.execute(sa.text("DROP TABLE IF EXISTS committees"))
