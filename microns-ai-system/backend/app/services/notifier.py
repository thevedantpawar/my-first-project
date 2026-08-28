"""Outbound notifications to n8n webhooks.

The backend owns PHI and decides *what* happened; n8n decides what to do about
it. These calls are the handoff between the two, and they carry UUIDs and
categories only.

Failures are swallowed on purpose: a clinic's phone line must not 500 because
the automation container is restarting. Every notification also has a polling
counterpart (``/internal/reviews/pending``, ``/internal/voice/pending-callbacks``,
``/internal/leads/pending-followup``), so a dropped webhook delays work rather
than losing it.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

try:  # pragma: no cover - present in the image
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore[assignment]


def notify_n8n(path: str, payload: dict[str, Any]) -> bool:
    """POST ``payload`` to an n8n webhook. Returns delivery success.

    ``path`` is the webhook path configured on the workflow's Webhook node,
    e.g. ``"lead-qualified"``.
    """
    base = (settings.n8n_webhook_base_url or "").rstrip("/")
    if not base or httpx is None:
        logger.debug("n8n notification skipped (no base URL configured): %s", path)
        return False

    url = f"{base}/{path.lstrip('/')}"
    try:
        response = httpx.post(url, json=payload, timeout=5.0)
        response.raise_for_status()
        logger.info("Notified n8n: %s", path)
        return True
    except Exception as exc:
        # Not an error the caller can act on — the polling endpoints cover it.
        logger.warning("n8n notification failed (%s): %s", path, type(exc).__name__)
        return False


def notify_lead_qualified(lead) -> bool:
    return notify_n8n(
        "lead-qualified",
        {
            "lead_id": str(lead.id),
            "score": lead.qualification_score,
            "temperature": lead.temperature,
            "status": lead.status,
            "next_action": lead.next_action,
            "treatment_interest": lead.treatment_interest,
            "timeline": lead.timeline,
            "needs_provider_approval": lead.needs_provider_approval,
            "medical_callback_required": lead.medical_callback_required,
        },
    )


def notify_treatment_completed(appointment) -> bool:
    return notify_n8n(
        "treatment-completed",
        {
            "appointment_id": str(appointment.id),
            "patient_uuid": str(appointment.patient_id),
            "service": appointment.service,
        },
    )


def notify_voice_handoff(*, call_record_id, patient_uuid, reason: str, priority: str = "normal") -> bool:
    return notify_n8n(
        "voice-handoff",
        {
            "call_record_id": str(call_record_id) if call_record_id else None,
            "patient_uuid": str(patient_uuid) if patient_uuid else None,
            # The patient's actual question stays in the encrypted transcript.
            "reason": reason,
            "priority": priority,
        },
    )


def notify_missed_call(*, call_record_id) -> bool:
    return notify_n8n(
        "missed-call",
        {"call_record_id": str(call_record_id) if call_record_id else None},
    )


__all__ = [
    "notify_n8n",
    "notify_lead_qualified",
    "notify_treatment_completed",
    "notify_voice_handoff",
    "notify_missed_call",
]
