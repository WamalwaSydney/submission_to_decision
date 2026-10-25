"""Password-reset token issuance and consumption; only SHA-256 digests are stored."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PasswordResetToken, User

RESET_TTL_MINUTES = 30


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_reset_token() -> tuple[str, str, datetime]:
    raw = secrets.token_urlsafe(32)
    return raw, _digest(raw), datetime.now(timezone.utc) + timedelta(minutes=RESET_TTL_MINUTES)


async def issue_reset(db: AsyncSession, user: User) -> tuple[str, datetime]:
    """Issue a single active code and return its raw value exactly once to caller."""
    now = datetime.now(timezone.utc)
    await db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    raw, digest, expires_at = create_reset_token()
    db.add(PasswordResetToken(user_id=user.id, token_hash=digest, expires_at=expires_at))
    await db.flush()
    return raw, expires_at


async def consume_reset(db: AsyncSession, raw_token: str, new_password_hash: str) -> bool:
    digest = _digest(raw_token)
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == digest,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        ).with_for_update()
    )
    reset = result.scalar_one_or_none()
    if reset is None:
        return False
    user_result = await db.execute(select(User).where(User.id == reset.user_id).with_for_update())
    user = user_result.scalar_one_or_none()
    if user is None or user.status != "active":
        reset.used_at = now
        await db.flush()
        return False
    user.password_hash = new_password_hash
    user.auth_version = (user.auth_version or 0) + 1
    user.recovery_codes_generated_at = None
    reset.used_at = now
    await db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    await db.flush()
    return True
