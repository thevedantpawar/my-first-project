"""Read endpoints for the owner console.

Every route here is a GET behind ``require_staff``. The console performs its
actions through the endpoints that already existed — ``/retention/*``,
``/api/appointments/*``, ``/leads/chat`` — so there is exactly one
implementation of every side effect in this system, and it is the one the
tests already cover.

The internal feeds (``/internal/*``) stay internal. They authenticate with
n8n's machine token, which a browser has no business holding; where the
console needs the same information it reads it through here instead, under a
staff token and the staff audit trail.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_audit, require_staff
from app.services.console_service import ConsoleService
from app.services.hipaa_audit import HIPAAAuditLogger

router = APIRouter(prefix="/console/api", tags=["console"])


def _service(db: Session, audit: HIPAAAuditLogger) -> ConsoleService:
    return ConsoleService(db, audit)


@router.get("/overview")
def overview(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """Headline numbers for the dashboard."""
    return _service(db, audit).overview(days=days, user=user)


@router.get("/opportunities")
def opportunities(
    limit: int = Query(default=60, ge=1, le=200),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """Everything waiting on a human, ranked by urgency."""
    return _service(db, audit).opportunities(limit=limit, user=user)


@router.get("/leads")
def leads(
    status: Optional[str] = Query(default=None),
    temperature: Optional[str] = Query(default=None),
    days: int = Query(default=90, ge=1, le=730),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """De-identified lead list. Names masked, phones last-four only."""
    return _service(db, audit).leads(
        status=status, temperature=temperature, days=days, limit=limit, user=user
    )


@router.get("/leads/{lead_id}")
def lead_detail(
    lead_id: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """One lead: answers, score breakdown, journey and conversation."""
    detail = _service(db, audit).lead_detail(lead_id, user=user)
    if detail is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return detail


@router.get("/conversations")
def conversations(
    limit: int = Query(default=60, ge=1, le=200),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """Chat, SMS and phone conversations in one list."""
    return _service(db, audit).conversations(limit=limit, user=user)


@router.get("/revenue")
def revenue(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """Revenue attribution and its coverage. Never extrapolated."""
    return _service(db, audit).revenue(days=days, user=user)


@router.get("/agents")
def agents(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """The engine's modules, described for an owner."""
    return _service(db, audit).agents(days=days, user=user)


@router.get("/workflows")
def workflows(
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """The five orchestration workflows and the actions they caused."""
    return _service(db, audit).workflows(user=user)


@router.get("/insights")
def insights(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """Plain-language observations, each with the count behind it."""
    return _service(db, audit).insights(days=days, user=user)


@router.get("/command-center")
def command_center(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """The owner's first screen, in one request.

    Six projections' worth of data in a single round trip, because this page
    is opened first thing in the morning on a front-desk laptop and six
    parallel requests is six chances to look slow.
    """
    return _service(db, audit).command_center(days=days, user=user)


@router.get("/recovery")
def recovery(
    days: int = Query(default=90, ge=1, le=365),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """No-shows, cancellations and dormant clients — attempted and won back.

    Ninety days by default: recovery is a slow loop and a thirty-day window
    understates it.
    """
    return _service(db, audit).recovery(days=days, user=user)


@router.get("/activity")
def activity(
    limit: int = Query(default=40, ge=1, le=200),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """What the engine did, newest first. Real events only."""
    return _service(db, audit).activity(limit=limit, user=user)


@router.get("/system")
def system(
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """What is actually connected, and what is not."""
    return _service(db, audit).system(user=user)


@router.get("/session")
def session(user: str = Depends(require_staff)) -> dict:
    """Cheap token check for the sign-in screen. Returns no data."""
    return {"authenticated": True, "actor": user}
