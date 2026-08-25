"""Shared FastAPI dependencies: request ids, audit logger, authentication.

Three trust zones, three dependencies:

``require_internal_token``
    Machine-to-machine calls from n8n inside the compose network.
``require_staff``
    Clinic staff reading dashboards and patient-level data.
Public
    VAPI and Twilio webhooks, and the chat widget. These authenticate by
    provider signature (see the routers) or not at all, and must never return
    PHI.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.services.hipaa_audit import HIPAAAuditLogger

logger = logging.getLogger(__name__)


def get_request_id(request: Request) -> str:
    """Correlation id for the audit trail. Set by the middleware in main.py."""
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


def get_audit(
    request: Request,
    db: Session = Depends(get_db),
) -> HIPAAAuditLogger:
    return HIPAAAuditLogger(db, request_id=get_request_id(request))


def client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def record_access_denial(db: Session, request: Request, *, reason: str, user_id: str) -> None:
    """Persist a failed access attempt.

    Committed immediately: the request is about to raise a 401, so nothing
    downstream will commit for us, and an audit trail that drops failed
    attempts is the one an auditor cares about most.
    """
    audit = HIPAAAuditLogger(db, request_id=get_request_id(request))
    audit.log_denied(reason=reason, ip_address=client_ip(request), user_id=user_id)
    try:
        db.commit()
    except Exception:  # pragma: no cover - never let auditing mask the 401
        db.rollback()
        logger.exception("Failed to persist access-denied audit record")


def require_internal_token(
    request: Request,
    x_internal_token: Optional[str] = Header(default=None, alias="X-Internal-Token"),
    db: Session = Depends(get_db),
) -> str:
    """Authenticate n8n → backend calls with a shared secret.

    Compared with :func:`secrets.compare_digest` so a wrong token cannot be
    recovered by timing the response.
    """
    expected = settings.internal_api_token
    if not expected or (expected.startswith("change-me") and not settings.is_production):
        logger.warning(
            "INTERNAL_API_TOKEN is unset or default — internal endpoints are unauthenticated. "
            "Set it before exposing this service."
        )
        return "unauthenticated-dev"

    if not x_internal_token or not secrets.compare_digest(x_internal_token, expected):
        record_access_denial(db, request, reason="invalid_internal_token", user_id="n8n")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing X-Internal-Token"
        )
    return "n8n"


def require_staff(
    request: Request,
    x_staff_token: Optional[str] = Header(default=None, alias="X-Staff-Token"),
    x_internal_token: Optional[str] = Header(default=None, alias="X-Internal-Token"),
    db: Session = Depends(get_db),
) -> str:
    """Authenticate a clinic-staff caller.

    A shared token is the right size of solution for a single-clinic
    deployment behind a VPN or an authenticating proxy. Swap this dependency
    for your IdP (Okta/Auth0/Cognito JWT verification) when you need per-user
    attribution in the audit trail — the ``user_id`` recorded here is what an
    auditor reads.
    """
    expected_staff = settings.staff_api_token
    expected_internal = settings.internal_api_token

    if not expected_staff and not settings.is_production:
        logger.warning("STAFF_API_TOKEN is unset — staff endpoints are unauthenticated.")
        return "unauthenticated-dev"

    if expected_staff and x_staff_token and secrets.compare_digest(x_staff_token, expected_staff):
        return "staff"
    if (
        expected_internal
        and x_internal_token
        and secrets.compare_digest(x_internal_token, expected_internal)
    ):
        return "n8n"

    record_access_denial(db, request, reason="invalid_staff_token", user_id="staff")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing X-Staff-Token"
    )
