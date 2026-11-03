"""Assigning bills to committees: official evidence, subject matter, administrator choices."""
import pytest
from sqlalchemy import text

from app.auth import create_access_token, get_password_hash
from app.committee_assignment import assign_committees, suggest_committee
from app.models import Committee, LegislativeItem, User
from tests.test_api import TestSession, client, db_session, test_engine  # noqa: F401  (pytest fixtures)


@pytest.mark.parametrize("institution,title,expected", [
    ("National Assembly", "The Central Bank of Kenya (Amendment) Bill, 2024", "Finance and National Planning"),
    ("National Assembly", "The Breastfeeding Mothers Bill, 2024", "Health"),
    ("National Assembly", "The County Allocation of Revenue Bill, 2025", "Budget and Appropriations Committee"),
    ("National Assembly", "The Foreign Service (Amendment) Bill, 2024", "Defence, Intelligence and Foreign Relations"),
    ("National Assembly", "The Maize Bill, 2025", "Agriculture and Livestock"),
    ("Nairobi City County Assembly", "The Nairobi City County Health Services Bill, 2025", "Health Services (Nairobi)"),
    ("Nairobi City County Assembly", "The Nairobi City County Wards Development Programme Bill, 2026", "Wards Development Fund (Nairobi)"),
    ("Trans Nzoia County Assembly", "Trans Nzoia Elimu Bursary Fund, 2014", "ICT, Early Childhood Education and Vocational Training (Trans Nzoia)"),
])
def test_subject_matter_suggestions(institution, title, expected):
    assert suggest_committee(institution, title) == expected


def test_unclear_titles_get_no_guess():
    assert suggest_committee("National Assembly", "The Miscellaneous Provisions Bill, 2025") is None


@pytest.mark.asyncio
async def test_assignment_fills_gaps_but_never_overrides_an_administrator(db_session):
    health = Committee(name="Health", institution="National Assembly")
    finance = Committee(name="Finance and National Planning", institution="National Assembly")
    db_session.add_all([health, finance])
    await db_session.flush()
    unassigned = LegislativeItem(title="The Mental Health Bill, 2026", identifier="NA/2026/Bill-950", institution="National Assembly", stage="First Reading", documents=[], status_history=[])
    chosen = LegislativeItem(title="The Health Levy Bill, 2026", identifier="NA/2026/Bill-951", institution="National Assembly", stage="First Reading",
                             documents=[], status_history=[], committee_id=finance.id, committee_assignment_source="administrator")
    db_session.add_all([unassigned, chosen])
    await db_session.commit()

    async with test_engine.begin() as conn:
        stats = await assign_committees(conn)
    assert stats["subject matter"] == 1
    async with TestSession() as session:
        rows = {row.identifier: row for row in (await session.execute(text("SELECT identifier, committee_id, committee_assignment_source FROM legislative_items"))).fetchall()}
    assert rows["NA/2026/Bill-950"].committee_id == health.id and rows["NA/2026/Bill-950"].committee_assignment_source == "subject matter"
    assert rows["NA/2026/Bill-951"].committee_id == finance.id and rows["NA/2026/Bill-951"].committee_assignment_source == "administrator"


@pytest.mark.asyncio
async def test_admin_assigns_and_confirms_committees(client, db_session):
    admin = User(name="Admin", email="admin-assign@example.com", role="administrator", password_hash=get_password_hash("password123"), status="active")
    citizen = User(name="Citizen", email="citizen-assign@example.com", role="citizen", password_hash=get_password_hash("password123"), status="active")
    health = Committee(name="Health", institution="National Assembly")
    county = Committee(name="Health Services (Nairobi)", institution="Nairobi City County Assembly")
    db_session.add_all([admin, citizen, health, county])
    await db_session.flush()
    bill = LegislativeItem(title="The Health Bill, 2026", identifier="NA/2026/Bill-952", institution="National Assembly", stage="First Reading",
                           documents=[], status_history=[], committee_id=health.id, committee_assignment_source="subject matter")
    db_session.add(bill)
    await db_session.commit()
    auth = lambda user: {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}

    assert client.put(f"/api/v1/bills/{bill.id}/committee", headers=auth(citizen), json={"committee_id": str(health.id)}).status_code == 403
    wrong_house = client.put(f"/api/v1/bills/{bill.id}/committee", headers=auth(admin), json={"committee_id": str(county.id)})
    assert wrong_house.status_code == 422 and "Nairobi" in wrong_house.json()["detail"]

    confirmed = client.post("/api/v1/bills/committee/confirm", headers=auth(admin), json={"bill_ids": [str(bill.id)]})
    assert confirmed.json() == {"confirmed": 1}
    assert client.get(f"/api/v1/bills/{bill.id}").json()["committee_assignment_source"] == "administrator"

    cleared = client.put(f"/api/v1/bills/{bill.id}/committee", headers=auth(admin), json={"committee_id": None})
    assert cleared.status_code == 200 and cleared.json()["bill"]["committee_id"] is None


@pytest.mark.asyncio
async def test_committee_can_be_created_without_an_account(client, db_session):
    admin = User(name="Admin", email="admin-create@example.com", role="administrator", password_hash=get_password_hash("password123"), status="active")
    db_session.add(admin)
    await db_session.commit()
    response = client.post("/api/v1/committees", headers={"Authorization": f"Bearer {create_access_token({'sub': str(admin.id)})}"},
                           json={"name": "Finance (Trans Nzoia)", "institution": "Trans Nzoia County Assembly"})
    assert response.status_code == 200, response.text
    assert response.json()["account"] is None
