"""In-memory rate limits.

* Every API request: 100 per minute per client IP (docs/SYSTEM.md).
* Sign-in: 5 failed attempts per email + IP in 15 minutes, and 30 attempts per
  IP in 15 minutes, which stops password guessing from one machine.
* Sign-up and password-reset requests: 10 per hour per IP.

Counters live in this process. That is enough for a single Render instance; if
the API is scaled to several instances, move these counters to Redis.
"""
from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

GLOBAL_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "100"))
LOGIN_FAILURES_PER_ACCOUNT = 5
LOGIN_ATTEMPTS_PER_IP = 30
LOGIN_WINDOW_SECONDS = 15 * 60
ACCOUNT_REQUESTS_PER_HOUR = 10

_hits: dict[str, deque] = defaultdict(deque)
_lock = Lock()


def client_ip(request: Request) -> str:
    """The caller's address. Render's proxy appends the real client address last."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _count(key: str, window: float, now: float) -> deque:
    hits = _hits[key]
    while hits and hits[0] <= now - window:
        hits.popleft()
    return hits


def hit(key: str, limit: int, window: float) -> tuple[bool, int]:
    """Record one hit. Returns (allowed, seconds until a slot frees up)."""
    now = time.monotonic()
    with _lock:
        hits = _count(key, window, now)
        if len(hits) >= limit:
            return False, max(1, int(hits[0] + window - now) + 1)
        hits.append(now)
        return True, 0


def too_many(key: str, limit: int, window: float) -> int:
    """Seconds to wait if the key is already at its limit (does not record a hit)."""
    now = time.monotonic()
    with _lock:
        hits = _count(key, window, now)
        return max(1, int(hits[0] + window - now) + 1) if len(hits) >= limit else 0


def record(key: str) -> None:
    with _lock:
        _hits[key].append(time.monotonic())


def clear(key: str) -> None:
    with _lock:
        _hits.pop(key, None)


def reset() -> None:
    """Forget every counter (used by tests)."""
    with _lock:
        _hits.clear()


def _retry_error(seconds: int, message: str) -> HTTPException:
    minutes = max(1, round(seconds / 60))
    return HTTPException(status_code=429, detail=f"{message} Try again in about {minutes} minute{'s' if minutes != 1 else ''}.", headers={"Retry-After": str(seconds)})


def check_login_allowed(request: Request, email: str) -> None:
    ip = client_ip(request)
    allowed, wait = hit(f"login-ip:{ip}", LOGIN_ATTEMPTS_PER_IP, LOGIN_WINDOW_SECONDS)
    if not allowed:
        raise _retry_error(wait, "Too many sign-in attempts from this network.")
    wait = too_many(f"login-fail:{email}:{ip}", LOGIN_FAILURES_PER_ACCOUNT, LOGIN_WINDOW_SECONDS)
    if wait:
        raise _retry_error(wait, "Too many failed sign-in attempts for this account.")


def record_login_failure(request: Request, email: str) -> None:
    record(f"login-fail:{email}:{client_ip(request)}")


def record_login_success(request: Request, email: str) -> None:
    clear(f"login-fail:{email}:{client_ip(request)}")


def check_account_request(request: Request, action: str) -> None:
    allowed, wait = hit(f"{action}:{client_ip(request)}", ACCOUNT_REQUESTS_PER_HOUR, 3600)
    if not allowed:
        raise _retry_error(wait, "Too many requests of this kind from this network.")


class GlobalRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/api/") and request.method != "OPTIONS":
            allowed, wait = hit(f"global:{client_ip(request)}", GLOBAL_LIMIT, 60)
            if not allowed:
                return JSONResponse(
                    {"detail": f"Too many requests. Try again in {wait} seconds."},
                    status_code=429, headers={"Retry-After": str(wait)},
                )
        return await call_next(request)
