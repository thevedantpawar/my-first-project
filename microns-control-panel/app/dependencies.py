"""Shared FastAPI dependencies: request ids, audit logging, authentication.

Three levels of access:

``current_user``
    A signed-in user, or 401.
``require_owner``
    A signed-in user who owns their account. Provisioning, billing and key
    escrow are owner actions.
``require_staff``
    A Microns operator. Spans every account, so it is set by an operator on the
    account row and is deliberately not something signup can produce.

Every clinic-scoped lookup goes through ``clinic_for_user``, which scopes the
query by ``account_id`` rather than fetching by id and comparing afterwards. A
mismatch there is one account reading another's clinic, so it is written the
way that cannot express the bug.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.clinic import Clinic
from app.models.user import User
from app.services import sessions
from app.services.audit import AuditLogger

logger = logging.getLogger(__name__)


def get_request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


def get_audit(request: Request, db: Session = Depends(get_db)) -> AuditLogger:
    return AuditLogger(db, request=request)


def _unauthorised() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sign in to continue.",
    )


def current_user_optional(
    request: Request,
    db: Session = Depends(get_db),
) -> Optional[User]:
    """The signed-in user, or None. Used by pages that render either way."""
    token = request.cookies.get(settings.session_cookie_name)
    parsed = sessions.read(token)
    if not parsed:
        return None

    user_id, epoch = parsed
    try:
        user = db.get(User, uuid.UUID(user_id))
    except (ValueError, TypeError):
        return None

    if user is None or not user.is_active:
        return None

    # The epoch is what makes a signed cookie revocable: a password change
    # bumps it, and every cookie issued before then stops working.
    if str(user.session_epoch) != epoch:
        logger.info("Rejected a session issued under a superseded epoch for %s", user.email)
        return None

    return user


def current_user(user: Optional[User] = Depends(current_user_optional)) -> User:
    if user is None:
        raise _unauthorised()
    return user


def require_owner(user: User = Depends(current_user)) -> User:
    """Actions that change infrastructure or billing."""
    if not user.is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action is restricted to the account owner.",
        )
    return user


def require_staff(user: User = Depends(current_user)) -> User:
    """Microns operators only — spans every account."""
    account = user.account
    if account is None or not account.is_staff:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not found.",
        )
    return user


def clinic_for_user(clinic_id: str, user: User, db: Session) -> Clinic:
    """Fetch a clinic, scoped to the caller's account.

    Written as a filtered query rather than "get, then compare" on purpose: the
    scoping is part of the lookup, so there is no path that returns a row
    belonging to another account. A clinic that exists but belongs to somebody
    else is a 404, not a 403 — a 403 would confirm the id is real.
    """
    try:
        parsed = uuid.UUID(str(clinic_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Clinic not found.")

    clinic = (
        db.query(Clinic)
        .filter(Clinic.id == parsed, Clinic.account_id == user.account_id)
        .one_or_none()
    )
    if clinic is None:
        raise HTTPException(status_code=404, detail="Clinic not found.")
    return clinic


__all__ = [
    "get_request_id",
    "get_audit",
    "current_user",
    "current_user_optional",
    "require_owner",
    "require_staff",
    "clinic_for_user",
]
