"""Shared test setup."""
import os

import pytest

# Tests must not start the background report worker (it uses the app database).
os.environ.setdefault("REPORT_WORKER_ENABLED", "false")

from app import rate_limit


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """Each test starts with fresh request counters."""
    rate_limit.reset()
    yield
    rate_limit.reset()
