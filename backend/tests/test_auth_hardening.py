from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.api.routes import RegisterRequest, PUBLIC_SIGNUP_ROLES
from app.password_reset import create_reset_token, _digest
from app.services.receipt_service import compute_receipt_hash
from app.recovery_codes import generate_recovery_codes, digest_recovery_code


def test_public_signup_payload_defaults_to_citizen_and_requires_strong_password():
    request = RegisterRequest(name="Example", email="example@example.com", password="correct horse battery")
    assert request.role == "citizen"
    with pytest.raises(ValidationError):
        RegisterRequest(name="Example", email="example@example.com", password="short")


def test_privileged_roles_are_not_public_role_choices():
    assert PUBLIC_SIGNUP_ROLES == {"citizen", "committee_officer"}
    assert {"administrator", "reviewer"}.isdisjoint(PUBLIC_SIGNUP_ROLES)


def test_password_reset_token_is_random_and_only_digest_is_persisted():
    raw1, digest1, expiry = create_reset_token()
    raw2, digest2, _ = create_reset_token()
    assert raw1 != raw2
    assert digest1 == _digest(raw1)
    assert raw1 != digest1
    assert digest1 != digest2
    assert expiry > datetime.now(timezone.utc)


def test_receipt_hash_uses_stable_timestamp_representation():
    common = {
        "id": "id", "author_id": "author", "legislative_item_id": "bill",
        "clause_ref": None, "submission_text": "Text", "previous_hash": "0" * 64,
    }
    naive = compute_receipt_hash({**common, "timestamp": datetime(2026, 1, 1)})
    aware = compute_receipt_hash({**common, "timestamp": datetime(2026, 1, 1, tzinfo=timezone.utc)})
    assert naive != aware


def test_recovery_codes_have_128_bits_and_are_unique():
    codes = generate_recovery_codes()
    assert len(codes) == 10
    assert len(set(codes)) == 10
    assert all(len(code) == 32 and all(ch in "0123456789abcdef" for ch in code) for code in codes)
    assert all(digest_recovery_code(code) != code for code in codes)


def test_recovery_code_generation_bounds():
    with pytest.raises(ValueError):
        generate_recovery_codes(0)
    with pytest.raises(ValueError):
        generate_recovery_codes(21)
