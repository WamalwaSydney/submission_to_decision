"""Shared test setup."""
import os

import pytest

# Tests must not start the background report worker (it uses the app database).
os.environ.setdefault("REPORT_WORKER_ENABLED", "false")
# Tests must never call the real Gemini API: matching and notification drafting
# would make paid network calls. Tests that exercise Gemini set a fake key and
# replace the HTTP client.
os.environ.pop("GEMINI_API_KEY", None)

from app import rate_limit


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """Each test starts with fresh request counters."""
    rate_limit.reset()
    yield
    rate_limit.reset()
