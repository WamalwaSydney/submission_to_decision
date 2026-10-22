"""Compatibility wrapper for the canonical AI-only matching service."""

from app.services.linking_service import (
    propose_matches,
    get_pending_matches,
    confirm_match,
    reject_match,
)

__all__ = [
    "propose_matches",
    "get_pending_matches",
    "confirm_match",
    "reject_match",
]
