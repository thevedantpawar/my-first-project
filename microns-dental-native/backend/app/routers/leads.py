"""Module 5 — lead qualification (website chat widget entry point)."""

from __future__ import annotations

import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_audit, require_staff
from app.models.lead import Lead
from app.ratelimit import chat_limiter
from app.schemas import ChatMessage, ChatReply, LeadOut, QualificationResult, QualificationSubmit
from app.services.hipaa_audit import HIPAAAuditLogger
from app.services.lead_service import LeadService

router = APIRouter(prefix="/leads", tags=["leads"])


@router.post("/chat", response_model=ChatReply)
def chat(
    payload: ChatMessage,
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ChatReply:
    """One turn of the qualification conversation. Powers the chat widget."""
    chat_limiter.check(request)

    if payload.message == "__init__":
        service = LeadService(db, audit)
        greeting = service.greeting()
        lead = service.get_or_create_by_session(payload.session_id or uuid.uuid4().hex, source=payload.source)
        lead.conversation_state = {"asking": greeting["asking"]}
        db.commit()
        return ChatReply(
            session_id=lead.session_id, reply=greeting["reply"], options=greeting["options"],
            asking=greeting["asking"], complete=False, status=lead.status,
        )

    result = LeadService(db, audit).chat(message=payload.message, session_id=payload.session_id, source=payload.source)
    return ChatReply(**result)


@router.post("/qualify", response_model=QualificationResult)
def qualify_direct(
    payload: QualificationSubmit,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> QualificationResult:
    """Submit all six answers at once (a form, or n8n handing off a completed SMS thread)."""
    service = LeadService(db, audit)

    lead = db.get(Lead, payload.lead_id) if payload.lead_id else None
    if lead is None:
        lead = service.get_or_create_by_session(payload.session_id or uuid.uuid4().hex, source=payload.source)

    if payload.phone:
        lead.set_phone(payload.phone)
    if payload.name:
        lead.set_name(payload.name)
    if payload.email:
        lead.set_email(payload.email)
    for field in ("treatment_interest", "last_visit", "insurance_type", "pain_level", "timeline"):
        value = getattr(payload, field)
        if value is not None:
            setattr(lead, field, value)
    db.flush()

    result = service.qualify(lead)
    return QualificationResult(lead_id=lead.id, **{k: v for k, v in result.items() if k != "lead_id"})


@router.get("/{lead_id}", response_model=LeadOut)
def get_lead(
    lead_id: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> LeadOut:
    view = LeadService(db, audit).lead_view(lead_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return LeadOut(**view)
