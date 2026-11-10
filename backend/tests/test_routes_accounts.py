"""Account API: registration rules, sign-in states, recovery codes, password resets,
and administrator user management."""
import uuid

import pytest
import pytest_asyncio

from app.auth import create_access_token, get_password_hash
from app.models import Committee, User
from tests.test_api import client, db_session  # noqa: F401  (pytest fixtures)

PASSWORD = "correct-horse-battery"


def bearer(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'ver': user.auth_version or 0})}"}


async def add_user(db_session, role="citizen", status="active", **fields):
    user = User(name=f"{role} user", email=f"{role}-{uuid.uuid4().hex[:8]}@example.com", role=role,
                password_hash=get_password_hash(PASSWORD), status=status, **fields)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def committee(db_session):
    c = Committee(name="Health", institution="National Assembly")
    db_session.add(c)
    await db_session.commit()
    await db_session.refresh(c)
    return c


@pytest_asyncio.fixture
async def admin(db_session):
    return await add_user(db_session, role="administrator")


def register(client, **fields):
    body = {"name": "Amina", "email": f"amina-{uuid.uuid4().hex[:6]}@example.com", "password": PASSWORD, **fields}
    return client.post("/api/v1/auth/register", json=body)


# ============ Registration and sign-in ============

@pytest.mark.asyncio
async def test_registration_rules(client, db_session, committee):
    assert register(client, role="administrator").status_code == 403
    assert register(client, name="   ").status_code == 422
    taken = register(client, email="taken@example.com", notification_language="sw")
    assert taken.status_code == 200 and taken.json()["user"]["notification_language"] == "sw"
    assert len(taken.json()["recovery_codes"]) > 0
    assert register(client, email="Taken@Example.com").status_code == 409

    assert register(client, role="committee_officer").status_code == 422
    assert register(client, role="committee_officer", committee_id=str(uuid.uuid4())).status_code == 404
    wrong_house = register(client, role="committee_officer", committee_id=str(committee.id), institution="Nairobi City County Assembly")
    assert wrong_house.status_code == 422 and "National Assembly" in wrong_house.json()["detail"]


@pytest.mark.asyncio
async def test_clerk_requests_wait_for_approval_and_suspended_accounts_cannot_sign_in(client, db_session, committee):
    email = "clerk-request@example.com"
    requested = register(client, role="committee_officer", committee_id=str(committee.id), institution="National Assembly", email=email)
    assert requested.json()["status"] == "pending_approval" and "access_token" not in requested.json()
    pending = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert pending.status_code == 403 and "pending" in pending.json()["detail"]

    suspended = await add_user(db_session, status="suspended")
    refused = client.post("/api/v1/auth/login", json={"email": suspended.email, "password": PASSWORD})
    assert refused.status_code == 403 and refused.json()["detail"] == "Account is not active"


# ============ Recovery codes ============

@pytest.mark.asyncio
async def test_recovery_codes_rotate_and_reset_a_password_once(client, db_session):
    user = await add_user(db_session)
    assert client.post("/api/v1/auth/recovery-codes", headers=bearer(user), json={"current_password": "wrong"}).status_code == 401
    rotated = client.post("/api/v1/auth/recovery-codes", headers=bearer(user), json={"current_password": PASSWORD})
    assert rotated.status_code == 200
    code = rotated.json()["recovery_codes"][0]
    assert client.get("/api/v1/auth/me", headers=bearer(user)).json()["user"]["recovery_codes_configured"] is True

    reset = {"email": user.email, "recovery_code": code, "password": "brand-new-password-1"}
    assert client.post("/api/v1/auth/password-reset/recovery-code", json={**reset, "recovery_code": "0" * 32}).status_code == 400
    assert client.post("/api/v1/auth/password-reset/recovery-code", json={**reset, "email": "nobody@example.com"}).status_code == 400
    assert client.post("/api/v1/auth/password-reset/recovery-code", json=reset).status_code == 200
    assert client.post("/api/v1/auth/password-reset/recovery-code", json=reset).status_code == 400  # used up

    # The old session is signed out and the new password works.
    assert client.get("/api/v1/auth/me", headers=bearer(user)).status_code == 403
    assert client.post("/api/v1/auth/login", json={"email": user.email, "password": "brand-new-password-1"}).status_code == 200


# ============ Administrator password resets ============

@pytest.mark.asyncio
async def test_administrators_issue_one_time_reset_codes(client, db_session, admin):
    user = await add_user(db_session)
    suspended = await add_user(db_session, status="suspended")
    assert client.post(f"/api/v1/users/{uuid.uuid4()}/password-reset", headers=bearer(admin)).status_code == 404
    assert client.post(f"/api/v1/users/{suspended.id}/password-reset", headers=bearer(admin)).status_code == 409
    assert client.post(f"/api/v1/users/{user.id}/password-reset", headers=bearer(user)).status_code == 403

    issued = client.post(f"/api/v1/users/{user.id}/password-reset", headers=bearer(admin))
    assert issued.status_code == 200
    token = issued.json()["reset_code"]
    complete = {"token": token, "password": "admin-reset-password-1"}
    assert client.post("/api/v1/auth/password-reset/complete", json={**complete, "token": "x" * 40}).status_code == 400
    assert client.post("/api/v1/auth/password-reset/complete", json=complete).status_code == 200
    assert client.post("/api/v1/auth/password-reset/complete", json=complete).status_code == 400
    assert client.post("/api/v1/auth/login", json={"email": user.email, "password": "admin-reset-password-1"}).status_code == 200


# ============ User management ============

@pytest.mark.asyncio
async def test_administrators_manage_accounts_within_the_rules(client, db_session, admin, committee):
    user = await add_user(db_session)
    listed = client.get("/api/v1/users", headers=bearer(admin))
    assert listed.status_code == 200 and {u["email"] for u in listed.json()["users"]} >= {admin.email, user.email}
    assert client.get("/api/v1/users", headers=bearer(user)).status_code == 403

    def update(target, **body):
        return client.put(f"/api/v1/users/{target}", headers=bearer(admin), json={"role": "citizen", "status": "active", **body})
    assert update(user.id, role="superuser").status_code == 422
    assert update(user.id, status="deleted").status_code == 422
    assert update(admin.id).status_code == 409  # cannot demote yourself
    assert update(uuid.uuid4()).status_code == 404
    assert update(user.id, role="committee_officer").status_code == 422
    assert update(user.id, role="committee_officer", committee_id=str(uuid.uuid4())).status_code == 404
    made_clerk = update(user.id, role="committee_officer", committee_id=str(committee.id))
    assert made_clerk.status_code == 200 and made_clerk.json()["user"]["committee_id"] == str(committee.id)
    back = update(user.id, status="suspended")
    assert back.json()["user"]["committee_id"] is None and back.json()["user"]["status"] == "suspended"


@pytest.mark.asyncio
async def test_clerk_access_requests_are_approved_for_an_active_committee(client, db_session, admin, committee):
    citizen = await add_user(db_session)
    active_clerk = await add_user(db_session, role="committee_officer", committee_id=committee.id)
    no_committee = await add_user(db_session, role="committee_officer", status="pending_approval")
    waiting = await add_user(db_session, role="committee_officer", status="pending_approval", committee_id=committee.id)

    def approve(target, **body):
        return client.post(f"/api/v1/users/{target.id}/approve-committee-officer", headers=bearer(admin), json=body)
    assert approve(citizen).status_code == 404
    assert approve(active_clerk).status_code == 409
    assert approve(no_committee).status_code == 422
    assert approve(no_committee, committee_id=str(uuid.uuid4())).status_code == 404
    approved = approve(waiting)
    assert approved.status_code == 200 and approved.json()["user"]["status"] == "active"
    assert approved.json()["committee"]["name"] == "Health"
