"""Writing the administrative audit trail.

Every method takes the request so the actor, address and correlation id are
recorded without the caller having to remember them. Nothing written here may
contain a secret — the point of the trail is to record that a secret was
touched, not to keep another copy of it.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.audit_event import AuditAction, AuditEvent
from app.services.secrets import scrub

logger = logging.getLogger("microns.control.audit")


def client_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


class AuditLogger:
    def __init__(self, db: Session, request: Optional[Request] = None) -> None:
        self.db = db
        self.request = request

    def log(
        self,
        action: str,
        *,
        outcome: str = "success",
        user=None,
        actor_email: Optional[str] = None,
        account_id: Optional[Any] = None,
        clinic_id: Optional[Any] = None,
        details: Optional[dict] = None,
    ) -> AuditEvent:
        """Record an administrative action.

        ``details`` is scrubbed before it is stored, so a caller that passes a
        whole request payload cannot accidentally persist a token in it.
        """
        request = self.request
        event = AuditEvent(
            action=action,
            outcome=outcome,
            actor_user_id=getattr(user, "id", None),
            actor_email=(actor_email or getattr(user, "email", None)),
            account_id=account_id if account_id is not None else getattr(user, "account_id", None),
            clinic_id=clinic_id,
            ip_address=client_ip(request),
            user_agent=(request.headers.get("user-agent")[:400] if request else None),
            request_id=getattr(request.state, "request_id", None) if request else None,
            details=scrub(details or {}),
        )
        self.db.add(event)

        logger.info(
            "AUDIT action=%s outcome=%s actor=%s account=%s clinic=%s",
            action,
            outcome,
            event.actor_email or event.actor_user_id,
            event.account_id,
            clinic_id,
        )
        return event

    def log_denied(self, reason: str, *, actor_email: Optional[str] = None, **kwargs) -> AuditEvent:
        """Record a refused action, and commit it immediately.

        The request is usually about to raise, so nothing downstream will
        commit for us — and a trail that drops failed attempts is missing the
        rows an access review most wants.
        """
        event = self.log(
            AuditAction.ACCESS_DENIED,
            outcome="denied",
            actor_email=actor_email,
            details={"reason": reason, **kwargs},
        )
        try:
            self.db.commit()
        except Exception:  # pragma: no cover - auditing must not mask the 401
            self.db.rollback()
            logger.exception("Failed to persist access-denied audit record")
        return event


__all__ = ["AuditLogger", "AuditAction", "client_ip"]
