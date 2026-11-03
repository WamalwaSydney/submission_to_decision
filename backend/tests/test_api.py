# Backend Tests

import pytest
import pytest_asyncio
import os
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
import uuid

from app.main import app
from app.database import Base, get_db
from app.models import User
from app.auth import create_access_token, get_password_hash

TEST_DB_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/participation_platform_test",
)

# NullPool: no connection is reused, so nothing is shared across event loops
test_engine = create_async_engine(TEST_DB_URL, poolclass=NullPool)
TestSession = async_sessionmaker(test_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def db_session():
    """Fresh schema for each test, in the configured test database.

    Skips only when PostgreSQL is unreachable. Schema errors fail loudly.
    Refuses to reset the schema in any database whose name does not contain 'test'.

    The schema is reset with DROP SCHEMA ... CASCADE instead of Base.metadata.drop_all
    because users <-> committees have a circular foreign key that drop_all cannot sort.
    """
    db_name = make_url(TEST_DB_URL).database or ""
    assert "test" in db_name, f"Refusing to reset schema in non-test database: {db_name}"

    try:
        async with test_engine.connect() as conn:
            await conn.execute(text("select 1"))
    except Exception as exc:
        pytest.skip(f"PostgreSQL test database is unavailable: {exc}")

    async with test_engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(Base.metadata.create_all)
        # Same append-only protection as production (20261012_integrity_provenance),
        # so code that tries to UPDATE or DELETE a receipt fails here too.
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION prevent_append_only_modification() RETURNS TRIGGER AS $$
            BEGIN RAISE EXCEPTION '% rows are append-only and cannot be modified or deleted', TG_TABLE_NAME; END;
            $$ LANGUAGE plpgsql"""))
        for table, prefix in (("participation_receipts", "receipt"), ("audit_log", "audit")):
            await conn.execute(text(f"CREATE TRIGGER trg_{prefix}_prevent_update BEFORE UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification()"))
            await conn.execute(text(f"CREATE TRIGGER trg_{prefix}_prevent_delete BEFORE DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification()"))

    async with TestSession() as session:
        yield session


@pytest.fixture
def client(db_session):
    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def auth_headers(db_session):
    """Create an active citizen account and return a valid bearer token."""
    user = User(
        name="Test Citizen",
        email="test-citizen@example.com",
        role="citizen",
        password_hash=get_password_hash("password123"),
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


# ============ Health Check ============

def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "version": "1.0.0"}


# ============ Bills ============

def test_list_bills_empty(client):
    response = client.get("/api/v1/bills")
    assert response.status_code == 200
    assert response.json() == {"bills": []}


def test_get_bill_not_found(client):
    response = client.get(f"/api/v1/bills/{uuid.uuid4()}")
    assert response.status_code == 404


def test_get_bill_invalid_id(client):
    response = client.get("/api/v1/bills/nonexistent")
    assert response.status_code == 422


# ============ Receipts ============

def test_create_receipt_unauthorized(client):
    response = client.post("/api/v1/receipts", data={
        "legislative_item_id": "test",
        "submission_text": "Test submission"
    })
    # FastAPI's HTTPBearer returns 403 when no token is sent; 401 is the stricter convention
    assert response.status_code in (401, 403)


def test_verify_chain_empty(client):
    response = client.get("/api/v1/receipts/verify")
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["total_checked"] == 0


# ============ Matches ============

def test_get_pending_matches_unauthorized(client):
    response = client.get("/api/v1/matches/pending")
    assert response.status_code in (401, 403)


def test_get_pending_matches_wrong_role(client, auth_headers):
    response = client.get("/api/v1/matches/pending", headers=auth_headers)
    # Should fail because user is citizen, not moderator
    assert response.status_code == 403


# ============ Profiles ============

def test_list_profiles_empty(client):
    response = client.get("/api/v1/profiles")
    assert response.status_code == 200
    assert response.json() == {"profiles": []}


def test_claim_profile_unauthorized(client):
    response = client.post("/api/v1/profiles/test/claim")
    assert response.status_code in (401, 403)


# ============ Notices ============

def test_list_notices_empty(client):
    response = client.get("/api/v1/notices")
    assert response.status_code == 200
    assert response.json() == {"notices": []}


# ============ Moderation ============

def test_report_content_unauthorized(client):
    response = client.post("/api/v1/reports/content", data={
        "content_type": "receipt",
        "content_id": "test",
        "reason": "Test reason"
    })
    assert response.status_code in (401, 403)


# ============ Exports ============
# /export/anonymized is currently public (matches production). These tests pin that
# behavior and guard against identifying fields leaking. If the endpoint is later
# restricted to administrators, change them to expect 401/403.

IDENTIFYING_FIELDS = {"author_id", "author_name_public", "email", "name", "password_hash", "user_id"}


def _assert_no_identifying_fields(payload):
    assert set(payload.keys()) == {"receipts", "report_entries", "confirmed_matches"}
    for items in payload.values():
        for item in items:
            assert IDENTIFYING_FIELDS.isdisjoint(item.keys())


def test_export_anonymized_is_public_and_has_no_identifying_fields(client):
    response = client.get("/api/v1/export/anonymized")
    assert response.status_code == 200
    _assert_no_identifying_fields(response.json())


def test_export_anonymized_same_for_citizen(client, auth_headers):
    response = client.get("/api/v1/export/anonymized", headers=auth_headers)
    assert response.status_code == 200
    _assert_no_identifying_fields(response.json())


# ============ Permission Tests ============

def test_permission_citizen_cannot_access_moderator_endpoints(client, auth_headers):
    """Test that citizens cannot access moderator endpoints."""
    response = client.get("/api/v1/matches/pending", headers=auth_headers)
    assert response.status_code == 403


def test_permission_citizen_cannot_access_clerk_endpoints(client, auth_headers):
    """Test that citizens cannot access clerk endpoints."""
    response = client.post("/api/v1/reports/upload", headers=auth_headers)
    assert response.status_code == 403


# ============ Hash Chain Tests ============

@pytest.mark.asyncio
async def test_hash_chain_integrity(db_session):
    """Test that hash chain verification works."""
    from app.services.receipt_service import verify_chain

    result = await verify_chain(db_session)
    assert result["valid"] is True
    assert result["total_checked"] == 0


# ============ Rate Limiting Tests ============

def test_rate_limiting_requires_authentication(client):
    """Unauthenticated submissions are rejected before quota evaluation."""
    response = client.post("/api/v1/receipts", data={
        "legislative_item_id": str(uuid.uuid4()),
        "submission_text": "Test submission",
    })
    assert response.status_code in (401, 403)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])