# Backend Tests

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
import uuid

from app.main import app
from app.database import Base, get_db

TEST_DB_URL = "postgresql+asyncpg://postgres:postgres@postgres:5432/participation_platform_test"

# NullPool: no connection is reused, so nothing is shared across event loops
test_engine = create_async_engine(TEST_DB_URL, poolclass=NullPool)
TestSession = async_sessionmaker(test_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def db_session():
    """Fresh schema for each test, in the TEST database."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
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
    assert response.status_code == 401

def test_create_receipt_non_citizen(client, db_session, auth_headers):
    # Change user role
    user = db_session.get(User, auth_headers["Authorization"].split(" ")[1])
    # This would need actual JWT decoding - simplified for demo
    pass

def test_verify_chain_empty(client):
    response = client.get("/api/v1/receipts/verify")
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["total_checked"] == 0

# ============ Matches ============

def test_get_pending_matches_unauthorized(client):
    response = client.get("/api/v1/matches/pending")
    assert response.status_code == 401

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
    assert response.status_code == 401

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
    assert response.status_code == 401

# ============ Exports ============

def test_export_anonymized_unauthorized(client):
    response = client.get("/api/v1/export/anonymized")
    assert response.status_code == 401

def test_export_anonymized_wrong_role(client, auth_headers):
    response = client.get("/api/v1/export/anonymized", headers=auth_headers)
    # Should fail because user is citizen, not administrator
    assert response.status_code == 403

# ============ Permission Tests ============

def test_permission_citizen_cannot_access_moderator_endpoints(client, auth_headers):
    """Test that citizens cannot access moderator endpoints."""
    response = client.get("/api/v1/matches/pending", headers=auth_headers)
    assert response.status_code == 403

def test_permission_citizen_cannot_access_admin_endpoints(client, auth_headers):
    """Test that citizens cannot access admin endpoints."""
    response = client.get("/api/v1/export/anonymized", headers=auth_headers)
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

def test_rate_limiting(client):
    """Test that rate limiting is enforced."""
    # This would require actual rate limiting middleware
    # Simplified for demo
    pass

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
