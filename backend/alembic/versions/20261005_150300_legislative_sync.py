"""Add legislative sync provenance and review fields.

Revision ID: 20261005_150300
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "20261005_150300"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The application schema already exists in the deployed project. These
    # guarded statements make this revision safe for that database and for
    # databases created from the existing schema documentation.
    for table, column, definition in [
        ("legislative_items", "bill_house", "VARCHAR(20)"),
        ("legislative_items", "bill_number", "INTEGER"),
        ("legislative_items", "bill_year", "INTEGER"),
        ("legislative_items", "source_url", "VARCHAR(1000)"),
        ("legislative_items", "source_file_ref", "VARCHAR(255)"),
        ("legislative_items", "source_updated_at", "DATE"),
        ("legislative_items", "source_status", "VARCHAR(100)"),
        ("notice_records", "source_url", "VARCHAR(1000)"),
        ("notice_records", "source_title", "VARCHAR(500)"),
        ("notice_records", "committee_name", "VARCHAR(255)"),
        ("notice_records", "published_date", "DATE"),
        ("committee_reports", "committee_name", "VARCHAR(255)"),
        ("committee_reports", "committee_url", "VARCHAR(1000)"),
        ("committee_reports", "title", "VARCHAR(1000)"),
        ("committee_reports", "bill_house", "VARCHAR(20)"),
        ("committee_reports", "bill_number", "INTEGER"),
        ("committee_reports", "bill_year", "INTEGER"),
        ("committee_reports", "source_url", "VARCHAR(1000)"),
    ]:
        op.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}"))

    op.execute(sa.text("ALTER TABLE committee_reports ALTER COLUMN bill_ref DROP NOT NULL"))
    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_source_url ON notice_records(source_url) WHERE source_url IS NOT NULL"))
    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_report_source_committee ON committee_reports(source_url, committee_url) WHERE source_url IS NOT NULL AND committee_url IS NOT NULL"))
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS legislative_link_reviews (
            id BIGSERIAL PRIMARY KEY,
            report_ref UUID NOT NULL REFERENCES committee_reports(id),
            candidate_bill_ref UUID NOT NULL REFERENCES legislative_items(id),
            match_method VARCHAR(30) NOT NULL,
            confidence_score DOUBLE PRECISION NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
            explanation TEXT NOT NULL,
            reviewer_decision VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (reviewer_decision IN ('pending','confirmed','rejected')),
            reviewer_id UUID REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(report_ref, candidate_bill_ref)
        )
    """))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS legislative_link_reviews"))
    op.execute(sa.text("DROP INDEX IF EXISTS uq_report_source_committee"))
    op.execute(sa.text("DROP INDEX IF EXISTS uq_notice_source_url"))
    for table, column in [
        ("committee_reports", "source_url"), ("committee_reports", "bill_year"),
        ("committee_reports", "bill_number"), ("committee_reports", "bill_house"),
        ("committee_reports", "title"), ("committee_reports", "committee_url"),
        ("committee_reports", "committee_name"), ("notice_records", "published_date"),
        ("notice_records", "committee_name"), ("notice_records", "source_title"),
        ("notice_records", "source_url"), ("legislative_items", "source_status"),
        ("legislative_items", "source_updated_at"), ("legislative_items", "source_file_ref"),
        ("legislative_items", "source_url"), ("legislative_items", "bill_year"),
        ("legislative_items", "bill_number"), ("legislative_items", "bill_house"),
    ]:
        op.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}"))
