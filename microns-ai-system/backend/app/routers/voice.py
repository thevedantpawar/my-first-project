"""VAPI voice-agent webhooks.

All three endpoints are authenticated by the ``X-Vapi-Secret`` header, which
VAPI sends with every server request when you configure a server secret on the
assistant.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_audit, record_access_denial
from app.schemas import VoiceActionResponse, VoiceEndRequest, VoiceInboundResponse
from app.services.hipaa_audit import HIPAAAuditLogger
from app.services.voice_service import VoiceService, extract_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["voice"])


def verify_vapi_secret(
    request: Request,
    x_vapi_secret: Optional[str] = Header(default=None, alias="X-Vapi-Secret"),
    db: Session = Depends(get_db),
) -> None:
    """Verify the shared secret VAPI sends on every server request.

    Without it, anyone who finds the URL can book, cancel and read appointment
    times. In development an unset secret logs a warning and allows the call so
    the flow can be exercised with curl; in production it is mandatory.
    """
    expected = settings.vapi_webhook_secret
    if not expected:
        if settings.is_production:
            raise HTTPException(status_code=503, detail="VAPI_WEBHOOK_SECRET is not configured")
        logger.warning("VAPI_WEBHOOK_SECRET is not set — voice webhooks are unauthenticated")
        return
    if not x_vapi_secret or not secrets.compare_digest(x_vapi_secret, expected):
        record_access_denial(db, request, reason="invalid_vapi_secret", user_id="vapi")
        raise HTTPException(status_code=401, detail="Invalid VAPI webhook secret")


@router.post("/inbound", response_model=VoiceInboundResponse)
async def inbound(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    _: None = Depends(verify_vapi_secret),
) -> VoiceInboundResponse:
    """Call started. Returns assistant overrides and the greeting."""
    payload = await _json_body(request)
    result = VoiceService(db, audit).handle_inbound(payload)
    return VoiceInboundResponse(
        call_record_id=result["call_record_id"],
        assistant_overrides=result["assistant_overrides"],
        known_patient=result["known_patient"],
        greeting=result["greeting"],
    )


@router.post("/action", response_model=VoiceActionResponse)
async def action(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    _: None = Depends(verify_vapi_secret),
) -> VoiceActionResponse:
    """Tool call from the assistant — availability, booking, pricing, callback."""
    payload = await _json_body(request)
    action_name, parameters, call_id = extract_action(payload)

    if not action_name:
        raise HTTPException(status_code=400, detail="No action or tool call in payload")

    result = VoiceService(db, audit).handle_action(
        action=action_name, parameters=parameters, call_id=call_id
    )
    return VoiceActionResponse(result=result.get("result", {}), speech=result.get("speech"))


@router.post("/end")
async def end(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    _: None = Depends(verify_vapi_secret),
) -> dict[str, Any]:
    """Call ended. Stores the encrypted transcript, duration and outcome."""
    payload = await _json_body(request)
    parsed = _parse_end_payload(payload)
    return VoiceService(db, audit).handle_end(
        call_id=parsed.call_id,
        transcript=parsed.transcript,
        duration_seconds=parsed.duration_seconds,
        outcome=parsed.outcome,
        ended_reason=parsed.ended_reason,
        summary=parsed.summary,
    )


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body must be JSON")
    return payload if isinstance(payload, dict) else {"payload": payload}


def _parse_end_payload(payload: dict[str, Any]) -> VoiceEndRequest:
    """Unpack an end-of-call-report body, whichever shape VAPI sent."""
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    call = message.get("call") if isinstance(message.get("call"), dict) else payload.get("call") or {}

    transcript = message.get("transcript") or payload.get("transcript")
    if not transcript and isinstance(message.get("artifact"), dict):
        transcript = message["artifact"].get("transcript")

    duration = (
        message.get("durationSeconds")
        or payload.get("duration_seconds")
        or payload.get("durationSeconds")
    )
    try:
        duration = int(float(duration)) if duration is not None else None
    except (TypeError, ValueError):
        duration = None

    summary_text = message.get("summary") or payload.get("summary")
    summary: dict[str, Any] = {}
    if isinstance(summary_text, dict):
        summary = summary_text
    elif isinstance(summary_text, str) and summary_text.strip():
        # A free-text call summary can quote the patient, so it is treated as
        # PHI: only its length is kept here, and the text stays in the
        # encrypted transcript.
        summary = {"summary_length": len(summary_text)}

    return VoiceEndRequest(
        call_id=call.get("id") or payload.get("call_id"),
        transcript=transcript,
        duration_seconds=duration,
        outcome=payload.get("outcome"),
        ended_reason=message.get("endedReason") or payload.get("ended_reason"),
        summary=summary,
    )
