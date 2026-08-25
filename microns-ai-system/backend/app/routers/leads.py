"""Lead qualification endpoints — website chat widget and inbound SMS."""

from __future__ import annotations

import logging
import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_audit, require_staff
from app.models.lead import Lead, LeadStatus
from app.ratelimit import chat_limiter, qualify_limiter
from app.schemas import ChatMessage, ChatReply, LeadOut, QualificationResult, QualificationSubmit
from app.services.hipaa_audit import HIPAAAuditLogger
from app.services.lead_service import LeadService
from app.services.sms_service import SMSService
from app.utils import to_utc_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/leads", tags=["leads"])


@router.post("/chat", response_model=ChatReply)
def chat(
    payload: ChatMessage,
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ChatReply:
    """One turn of the website chat qualification.

    Public by design — the widget is embedded on the clinic's marketing site.
    It is rate limited, and its response is de-identified: it never echoes back
    anything the caller did not already send.
    """
    chat_limiter.check(request)
    service = LeadService(db, audit)

    # Empty first message = "open the widget", so answer with the greeting
    # instead of trying to parse nothing.
    if payload.message in {"", "__init__", "hello", "hi"} and not payload.session_id:
        session_id = uuid.uuid4().hex
        lead = service.get_or_create_by_session(session_id, source=payload.source)
        greeting = service.greeting()
        lead.conversation_state = {"asking": greeting["asking"], "turns": 0}
        db.commit()
        return ChatReply(
            session_id=session_id,
            reply=greeting["reply"],
            options=greeting["options"],
            asking=greeting["asking"],
            status=lead.status,
        )

    result = service.chat(
        message=payload.message, session_id=payload.session_id, source=payload.source
    )
    return ChatReply(
        session_id=result["session_id"],
        reply=result["reply"],
        options=result["options"],
        asking=result["asking"],
        complete=result["complete"],
        status=result["status"],
        score=result["score"],
        next_action=result["next_action"],
        booking_url=result.get("booking_url"),
    )


@router.post("/sms-inbound")
async def sms_inbound(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> Response:
    """Twilio inbound-SMS webhook.

    Twilio posts form-encoded data and expects TwiML back. The reply is sent
    through :class:`SMSService` rather than returned as ``<Message>`` TwiML, so
    it passes the same consent check and lands in the same audit trail as every
    other message this system sends. The TwiML response is therefore empty.
    """
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}

    signature = request.headers.get("X-Twilio-Signature")
    if not SMSService.validate_signature(str(request.url), params, signature):
        audit.log_denied(reason="invalid_twilio_signature", user_id="twilio")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    from_number = params.get("From", "")
    body = params.get("Body", "")
    if not from_number:
        return _twiml()

    # STOP/START are handled by Twilio's own opt-out machinery; record the
    # consent change on our side too so we stop queueing marketing SMS.
    keyword = body.strip().upper()
    if keyword in {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"}:
        _set_marketing_consent(db, from_number, False)
        audit.log_sms_received(None, message_sid=params.get("MessageSid"))
        return _twiml()
    if keyword in {"START", "UNSTOP", "YES"}:
        _set_marketing_consent(db, from_number, True)
        return _twiml()

    try:
        LeadService(db, audit).handle_sms(from_phone=from_number, body=body)
    except Exception:
        # Never leak an exception body back to Twilio — it could contain PHI.
        logger.exception("Inbound SMS handling failed")
        return _twiml()

    return _twiml()


@router.post("/qualify", response_model=QualificationResult)
def qualify(
    payload: QualificationSubmit,
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> QualificationResult:
    """Submit qualification answers directly and get the score + next action.

    Used by a static intake form, or by n8n replaying answers collected
    elsewhere.
    """
    qualify_limiter.check(request)
    service = LeadService(db, audit)

    if payload.lead_id is not None:
        lead = db.get(Lead, payload.lead_id)
        if lead is None:
            raise HTTPException(status_code=404, detail="Lead not found")
    else:
        lead = service.get_or_create_by_session(
            payload.session_id or uuid.uuid4().hex, source=payload.source
        )

    if payload.name:
        lead.set_name(payload.name)
    if payload.phone:
        lead.set_phone(payload.phone)
    if payload.email:
        lead.set_email(payload.email)

    for field in (
        "treatment_interest",
        "previous_experience",
        "is_pregnant",
        "blood_thinner",
        "budget_range",
        "timeline",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(lead, field, value)

    if lead.status == LeadStatus.NEW:
        lead.status = LeadStatus.QUALIFYING
    db.flush()

    result = service.qualify(lead)
    return QualificationResult(
        lead_id=result["lead_id"],
        score=result["score"],
        temperature=result["temperature"],
        status=result["status"],
        next_action=result["next_action"],
        needs_provider_approval=result["needs_provider_approval"],
        medical_callback_required=result["medical_callback_required"],
        booking_url=result.get("booking_url"),
        score_breakdown=result["score_breakdown"],
        answered_questions=result["answered_questions"],
    )


@router.get("/{lead_id}", response_model=LeadOut)
def get_lead(
    lead_id: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> LeadOut:
    """De-identified lead status. Name is masked, phone is last-four only."""
    view = LeadService(db, audit).lead_view(lead_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return LeadOut(
        lead_id=view["lead_id"],
        source=view["source"],
        status=view["status"],
        temperature=view["temperature"],
        score=view["score"],
        treatment_interest=view["treatment_interest"],
        budget_range=view["budget_range"],
        timeline=view["timeline"],
        needs_provider_approval=view["needs_provider_approval"],
        medical_callback_required=view["medical_callback_required"],
        display_name=view["display_name"],
        masked_phone=view["masked_phone"],
        created_at=to_utc_naive(view["created_at"]),
        answered_questions=view["answered_questions"],
    )


def _twiml(message: str | None = None) -> Response:
    body = "<Response>"
    if message:
        escaped = (
            message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        )
        body += f"<Message>{escaped}</Message>"
    body += "</Response>"
    return Response(content=f'<?xml version="1.0" encoding="UTF-8"?>{body}', media_type="application/xml")


def _set_marketing_consent(db: Session, phone: str, consent: bool) -> None:
    from app.services.patient_service import find_by_phone

    patient = find_by_phone(db, phone)
    if patient is not None:
        patient.marketing_consent = consent
        if not consent:
            patient.sms_consent = False
        db.commit()
        logger.info("Updated SMS consent for patient %s to %s", patient.id, consent)
