"""Centralized audit-event writer for sensitive state changes."""
from typing import Any, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import AuditLog

async def record_audit(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    action: str,
    actor_id: Optional[UUID] = None,
    details: Optional[dict[str, Any]] = None,
) -> AuditLog:
    event = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=actor_id,
        details=__import__('json').dumps(details or {}, sort_keys=True, default=str),
    )
    db.add(event)
    await db.flush()
    return event
