"""Patient retention: reminders, no-show recovery, reviews, reactivation.

Every action here is **idempotent**. The n8n workflows fire on a cron and will
happily hand the same appointment to the same endpoint twice — on a retry,
after a restart, or because two schedules overlap. Each send is therefore
guarded by a timestamp column (``reminder_24h_sent_at`` and friends): the
second call is a no-op that reports ``skipped``, not a second text message to a
patient.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment, AppointmentStatus
from app.models.lead import Lead, LeadStatus
from app.models.patient import Patient
from app.models.retention_event import RetentionEvent, RetentionEventType
from app.services import sms_service as templates
from app.services.deidentify import DeidentificationContext
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.llm import get_llm
from app.services.sms_service import SMSService
from app.utils import days_ago, hours_until, mask_name, utcnow

logger = logging.getLogger(__name__)


class RetentionService:
    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.sms = SMSService(db, self.audit)

    # ------------------------------------------------------------------ #
    # Event log
    # ------------------------------------------------------------------ #
    def record_event(
        self,
        *,
        event_type: str,
        patient_id: Optional[UUID] = None,
        appointment_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        channel: str = "sms",
        metadata: Optional[dict[str, Any]] = None,
    ) -> RetentionEvent:
        event = RetentionEvent(
            event_type=event_type,
            patient_id=patient_id,
            appointment_id=appointment_id,
            lead_id=lead_id,
            channel=channel,
            # Non-PHI only: SMS status, template name, links.
            event_metadata=metadata or {},
        )
        self.db.add(event)
        self.db.flush()
        return event

    # ------------------------------------------------------------------ #
    # Workflow A — no-show prevention
    # ------------------------------------------------------------------ #
    def upcoming_appointments(self, within_hours: int = 48) -> list[dict[str, Any]]:
        """Appointments due inside the window, as a **de-identified** payload.

        This is what n8n consumes. It contains no name and no phone number:
        the workflow decides *whether* to send, the backend decides *what* to
        send and to whom. That keeps PHI inside one service and keeps every
        message on the audit trail.
        """
        now = utcnow()
        horizon = now + timedelta(hours=within_hours)
        rows = (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.status.in_(AppointmentStatus.ACTIVE),
                    Appointment.scheduled_for >= now,
                    Appointment.scheduled_for <= horizon,
                )
                .order_by(Appointment.scheduled_for)
            )
            .scalars()
            .all()
        )

        self.audit.log_read(None, DataCategory.APPOINTMENT, "n8n", details={"count": len(rows)})

        payload = []
        for appointment in rows:
            remaining = hours_until(appointment.scheduled_for, now)
            payload.append(
                {
                    "appointment_id": str(appointment.id),
                    "patient_uuid": str(appointment.patient_id),
                    "service": appointment.service,
                    "scheduled_for": appointment.scheduled_for.isoformat() + "Z",
                    "hours_until": round(remaining, 2),
                    "status": appointment.status,
                    # The workflow's IF nodes read these booleans directly.
                    "due_24h_reminder": 20 <= remaining <= 28 and appointment.reminder_24h_sent_at is None,
                    "due_2h_reminder": 1 <= remaining <= 3 and appointment.reminder_2h_sent_at is None,
                    "reminder_24h_sent": appointment.reminder_24h_sent_at is not None,
                    "reminder_2h_sent": appointment.reminder_2h_sent_at is not None,
                }
            )
        return payload

    def send_reminder(self, appointment_id: UUID, kind: str = "24h") -> dict[str, Any]:
        """Send a 24h or 2h reminder. Safe to call repeatedly."""
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found", "appointment_id": str(appointment_id)}
        if not appointment.is_active:
            return {"status": "skipped", "reason": f"appointment_{appointment.status}"}

        already_sent = (
            appointment.reminder_24h_sent_at if kind == "24h" else appointment.reminder_2h_sent_at
        )
        if already_sent is not None:
            return {"status": "skipped", "reason": "already_sent", "sent_at": already_sent.isoformat()}

        patient = appointment.patient
        first_name = _first_name(patient)
        builder = templates.reminder_24h if kind == "24h" else templates.reminder_2h
        body = builder(service=appointment.service, when=appointment.scheduled_for, first_name=first_name)

        result = self.sms.send(
            to=patient.phone if patient else None,
            body=body,
            template=f"reminder_{kind}",
            patient_uuid=str(appointment.patient_id),
            sms_consent=patient.sms_consent if patient else None,
        )

        now = utcnow()
        if kind == "24h":
            appointment.reminder_24h_sent_at = now
        else:
            appointment.reminder_2h_sent_at = now

        self.record_event(
            event_type=(
                RetentionEventType.REMINDER_SENT
                if kind == "24h"
                else RetentionEventType.FINAL_REMINDER_SENT
            ),
            patient_id=appointment.patient_id,
            appointment_id=appointment.id,
            metadata={
                "kind": kind,
                "sms_status": result.status,
                "message_sid": result.message_sid,
                "suppressed_reason": result.reason,
            },
        )
        self.db.commit()
        return {
            "status": "sent" if result.ok else "failed",
            "sms_status": result.status,
            "appointment_id": str(appointment.id),
            "kind": kind,
        }

    # ------------------------------------------------------------------ #
    # Workflow B — no-show recovery
    # ------------------------------------------------------------------ #
    def detect_no_shows(self, grace_hours: int = 2) -> list[dict[str, Any]]:
        """Flip stale confirmed appointments to ``no_show``.

        Without this the daily recovery workflow has nothing to act on unless
        front-desk staff mark every miss by hand — which is exactly the manual
        step the system exists to remove.
        """
        cutoff = utcnow() - timedelta(hours=grace_hours)
        rows = (
            self.db.execute(
                select(Appointment).where(
                    Appointment.status.in_(AppointmentStatus.ACTIVE),
                    Appointment.scheduled_for < cutoff,
                )
            )
            .scalars()
            .all()
        )
        flagged = []
        for appointment in rows:
            appointment.status = AppointmentStatus.NO_SHOW
            self.record_event(
                event_type=RetentionEventType.NO_SHOW,
                patient_id=appointment.patient_id,
                appointment_id=appointment.id,
                channel="system",
                metadata={"detected_by": "grace_period", "grace_hours": grace_hours},
            )
            flagged.append({"appointment_id": str(appointment.id), "patient_uuid": str(appointment.patient_id)})
        if flagged:
            self.db.commit()
            logger.info("Flagged %d appointment(s) as no-show", len(flagged))
        return flagged

    def recent_no_shows(self, days: int = 1) -> list[dict[str, Any]]:
        """No-shows from the last ``days`` days, de-identified, for n8n."""
        since = days_ago(days)
        rows = (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.status == AppointmentStatus.NO_SHOW,
                    Appointment.scheduled_for >= since,
                )
                .order_by(Appointment.scheduled_for.desc())
            )
            .scalars()
            .all()
        )
        self.audit.log_read(None, DataCategory.APPOINTMENT, "n8n", details={"count": len(rows)})
        return [
            {
                "appointment_id": str(row.id),
                "patient_uuid": str(row.patient_id),
                "service": row.service,
                "scheduled_for": row.scheduled_for.isoformat() + "Z",
                "reactivation_sent": row.reactivation_sent_at is not None,
                "credit_offer_sent": row.credit_offer_sent_at is not None,
                "rebooked": self.has_rebooked(row),
            }
            for row in rows
        ]

    def send_reactivation(self, appointment_id: UUID) -> dict[str, Any]:
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found"}
        if appointment.reactivation_sent_at is not None:
            return {"status": "skipped", "reason": "already_sent"}
        if self.has_rebooked(appointment):
            return {"status": "skipped", "reason": "already_rebooked"}

        patient = appointment.patient
        result = self.sms.send(
            to=patient.phone if patient else None,
            body=templates.no_show_reactivation(first_name=_first_name(patient)),
            template="no_show_reactivation",
            patient_uuid=str(appointment.patient_id),
            sms_consent=patient.sms_consent if patient else None,
            marketing_consent=patient.marketing_consent if patient else None,
        )
        appointment.reactivation_sent_at = utcnow()
        self.record_event(
            event_type=RetentionEventType.REACTIVATION_SENT,
            patient_id=appointment.patient_id,
            appointment_id=appointment.id,
            metadata={"sms_status": result.status, "suppressed_reason": result.reason},
        )
        self.db.commit()
        return {"status": "sent" if result.ok else "suppressed", "sms_status": result.status}

    def send_credit_offer(self, appointment_id: UUID) -> dict[str, Any]:
        """The '$50 credit expires tomorrow' nudge, 3 days after a no-show."""
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found"}
        if appointment.credit_offer_sent_at is not None:
            return {"status": "skipped", "reason": "already_sent"}
        if self.has_rebooked(appointment):
            return {"status": "skipped", "reason": "already_rebooked"}

        patient = appointment.patient
        result = self.sms.send(
            to=patient.phone if patient else None,
            body=templates.no_show_credit_offer(first_name=_first_name(patient)),
            template="no_show_credit_offer",
            patient_uuid=str(appointment.patient_id),
            sms_consent=patient.sms_consent if patient else None,
            marketing_consent=patient.marketing_consent if patient else None,
        )
        appointment.credit_offer_sent_at = utcnow()
        self.record_event(
            event_type=RetentionEventType.CREDIT_OFFER_SENT,
            patient_id=appointment.patient_id,
            appointment_id=appointment.id,
            metadata={
                "sms_status": result.status,
                "credit_amount": settings.no_show_credit_amount,
                "suppressed_reason": result.reason,
            },
        )
        self.db.commit()
        return {"status": "sent" if result.ok else "suppressed", "sms_status": result.status}

    def has_rebooked(self, appointment: Appointment) -> bool:
        """Did this patient book anything after the missed appointment?"""
        count = self.db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.patient_id == appointment.patient_id,
                Appointment.id != appointment.id,
                Appointment.created_at > appointment.scheduled_for,
                Appointment.status.in_(
                    (AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED)
                ),
            )
        )
        return bool(count)

    # ------------------------------------------------------------------ #
    # Workflow C — reviews
    # ------------------------------------------------------------------ #
    def treatment_completed(self, appointment_id: UUID) -> dict[str, Any]:
        """Mark an appointment complete and open the review window."""
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found"}
        now = utcnow()
        appointment.status = AppointmentStatus.COMPLETED
        appointment.completed_at = now
        if appointment.patient is not None:
            appointment.patient.last_visit_at = now
            appointment.patient.append_treatment(
                {"service": appointment.service, "date": now.isoformat(), "provider": appointment.provider}
            )
        self.record_event(
            event_type=RetentionEventType.TREATMENT_COMPLETED,
            patient_id=appointment.patient_id,
            appointment_id=appointment.id,
            channel="system",
            metadata={"service": appointment.service},
        )
        self.db.commit()
        return {
            "status": "completed",
            "appointment_id": str(appointment.id),
            "patient_uuid": str(appointment.patient_id),
            "review_due_at": (now + timedelta(days=settings.review_request_delay_days)).isoformat() + "Z",
        }

    def request_review(self, appointment_id: UUID, *, force: bool = False) -> dict[str, Any]:
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found"}
        if appointment.review_requested_at is not None and not force:
            return {"status": "skipped", "reason": "already_requested"}
        if appointment.review_received_at is not None:
            return {"status": "skipped", "reason": "review_already_received"}
        if appointment.status != AppointmentStatus.COMPLETED and not force:
            return {"status": "skipped", "reason": f"appointment_{appointment.status}"}

        patient = appointment.patient
        result = self.sms.send(
            to=patient.phone if patient else None,
            body=templates.review_request(first_name=_first_name(patient)),
            template="review_request",
            patient_uuid=str(appointment.patient_id),
            sms_consent=patient.sms_consent if patient else None,
            marketing_consent=patient.marketing_consent if patient else None,
        )
        appointment.review_requested_at = utcnow()
        self.record_event(
            event_type=RetentionEventType.REVIEW_REQUESTED,
            patient_id=appointment.patient_id,
            appointment_id=appointment.id,
            metadata={"sms_status": result.status, "review_url": settings.clinic_review_url},
        )
        self.db.commit()
        return {"status": "sent" if result.ok else "suppressed", "sms_status": result.status}

    def review_status(self, appointment_id: UUID) -> dict[str, Any]:
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found"}
        return {
            "appointment_id": str(appointment.id),
            "patient_uuid": str(appointment.patient_id),
            "review_requested": appointment.review_requested_at is not None,
            "review_received": appointment.review_received_at is not None,
            "eligible_for_request": (
                appointment.status == AppointmentStatus.COMPLETED
                and appointment.review_requested_at is None
                and appointment.review_received_at is None
            ),
        }

    def record_review(
        self, appointment_id: UUID, *, rating: Optional[int], review_text: Optional[str]
    ) -> dict[str, Any]:
        """Record an inbound review and draft a reply for manager approval.

        The draft is generated from de-identified text and is never published
        automatically — a human approves it in Slack/email first, because a
        public reply that confirms someone was a patient is itself a
        disclosure.
        """
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found"}

        appointment.review_received_at = utcnow()
        self.record_event(
            event_type=RetentionEventType.REVIEW_RECEIVED,
            patient_id=appointment.patient_id,
            appointment_id=appointment.id,
            channel="review",
            metadata={"rating": rating},
        )

        draft = self.draft_review_response(
            review_text=review_text, rating=rating, patient_uuid=str(appointment.patient_id)
        )
        if draft:
            self.record_event(
                event_type=RetentionEventType.REVIEW_RESPONSE_DRAFTED,
                patient_id=appointment.patient_id,
                appointment_id=appointment.id,
                channel="review",
                metadata={"generated_by": "llm" if get_llm().available else "template"},
            )
        self.db.commit()
        return {
            "status": "recorded",
            "appointment_id": str(appointment.id),
            "rating": rating,
            "draft_response": draft,
            "requires_human_approval": True,
        }

    def draft_review_response(
        self, *, review_text: Optional[str], rating: Optional[int], patient_uuid: Optional[str] = None
    ) -> str:
        context = DeidentificationContext(patient_uuid=patient_uuid)
        safe_review = context.deidentify(review_text or "")

        system = (
            f"You write short public review responses for {settings.clinic_name}, a med spa. "
            "Rules: 2-3 sentences, warm and specific, never confirm what treatment anyone "
            "received, never discuss medical details, never mention a patient by name. "
            "Placeholders like [PATIENT_1] are opaque tokens — keep them verbatim if you use "
            "them. For a rating of 3 or below, apologise and invite the reviewer to contact "
            "the clinic manager privately."
        )
        user = f"Rating: {rating if rating is not None else 'unknown'}/5\nReview: {safe_review}"

        # gpt-4o rather than mini: this text is published under the clinic's
        # name, and tone mistakes here are expensive.
        reply = get_llm().complete_text(
            system=system,
            user=user,
            purpose="review_response_draft",
            model=settings.openai_model_smart,
            temperature=0.6,
            max_tokens=200,
            audit=self.audit,
            patient_uuid=patient_uuid,
        )
        if not reply:
            reply = _fallback_review_reply(rating)
        return context.reidentify(reply)

    # ------------------------------------------------------------------ #
    # Dormant patients
    # ------------------------------------------------------------------ #
    def patients_at_risk(self, days: Optional[int] = None, limit: int = 200) -> list[dict[str, Any]]:
        """Patients with no visit in ``days`` (default 45) and nothing booked."""
        days = days or settings.reactivation_days
        cutoff = days_ago(days)

        booked_subquery = (
            select(Appointment.patient_id)
            .where(
                Appointment.status.in_(AppointmentStatus.ACTIVE),
                Appointment.scheduled_for >= utcnow(),
            )
            .distinct()
        )

        rows = (
            self.db.execute(
                select(Patient)
                .where(
                    or_(Patient.last_visit_at.is_(None), Patient.last_visit_at <= cutoff),
                    Patient.id.not_in(booked_subquery),
                )
                # Never-visited first, then longest-dormant. Expressed this way
                # rather than with NULLS LAST so it behaves identically on
                # PostgreSQL and SQLite.
                .order_by(Patient.last_visit_at.is_(None).desc(), Patient.last_visit_at.asc())
                .limit(limit)
            )
            .scalars()
            .all()
        )

        self.audit.log_read(None, DataCategory.DASHBOARD, "staff", details={"count": len(rows)})

        result = []
        for patient in rows:
            days_since = (
                int((utcnow() - patient.last_visit_at).days) if patient.last_visit_at else None
            )
            result.append(
                {
                    "patient_uuid": str(patient.id),
                    # Masked, not raw: this feeds a staff dashboard.
                    "display_name": mask_name(patient.name) or "Unknown",
                    "days_since_last_visit": days_since,
                    "last_visit_at": (
                        patient.last_visit_at.isoformat() + "Z" if patient.last_visit_at else None
                    ),
                    "reactivation_sent_at": (
                        patient.reactivation_sent_at.isoformat() + "Z"
                        if patient.reactivation_sent_at
                        else None
                    ),
                    "marketing_consent": patient.marketing_consent,
                }
            )
        return result

    def send_dormant_reactivation(self, patient_id: UUID, *, cooldown_days: int = 30) -> dict[str, Any]:
        patient = self.db.get(Patient, patient_id)
        if patient is None:
            return {"status": "not_found"}
        if (
            patient.reactivation_sent_at is not None
            and patient.reactivation_sent_at > days_ago(cooldown_days)
        ):
            return {"status": "skipped", "reason": "cooldown"}

        result = self.sms.send(
            to=patient.phone,
            body=templates.dormant_reactivation(
                first_name=_first_name(patient), days=settings.reactivation_days
            ),
            template="dormant_reactivation",
            patient_uuid=str(patient.id),
            sms_consent=patient.sms_consent,
            marketing_consent=patient.marketing_consent,
        )
        patient.reactivation_sent_at = utcnow()
        self.record_event(
            event_type=RetentionEventType.REACTIVATION_SENT,
            patient_id=patient.id,
            metadata={"sms_status": result.status, "trigger": "dormant", "suppressed_reason": result.reason},
        )
        self.db.commit()
        return {"status": "sent" if result.ok else "suppressed", "sms_status": result.status}

    # ------------------------------------------------------------------ #
    # Dashboard
    # ------------------------------------------------------------------ #
    def dashboard(self, days: int = 30) -> dict[str, Any]:
        since = days_ago(days)

        def count_appointments(*conditions) -> int:
            return int(
                self.db.scalar(
                    select(func.count(Appointment.id)).where(
                        Appointment.scheduled_for >= since, *conditions
                    )
                )
                or 0
            )

        total = count_appointments()
        no_shows = count_appointments(Appointment.status == AppointmentStatus.NO_SHOW)
        completed = count_appointments(Appointment.status == AppointmentStatus.COMPLETED)
        cancelled = count_appointments(Appointment.status == AppointmentStatus.CANCELLED)

        def count_events(event_type: str) -> int:
            return int(
                self.db.scalar(
                    select(func.count(RetentionEvent.id)).where(
                        RetentionEvent.created_at >= since,
                        RetentionEvent.event_type == event_type,
                    )
                )
                or 0
            )

        reviews_requested = count_events(RetentionEventType.REVIEW_REQUESTED)
        reviews_received = count_events(RetentionEventType.REVIEW_RECEIVED)
        reactivations_sent = count_events(RetentionEventType.REACTIVATION_SENT)
        rebooked = count_events(RetentionEventType.REBOOKED)

        at_risk = int(
            self.db.scalar(
                select(func.count(Patient.id)).where(
                    or_(
                        Patient.last_visit_at.is_(None),
                        Patient.last_visit_at <= days_ago(settings.reactivation_days),
                    )
                )
            )
            or 0
        )

        leads_total = int(
            self.db.scalar(select(func.count(Lead.id)).where(Lead.created_at >= since)) or 0
        )
        leads_booked = int(
            self.db.scalar(
                select(func.count(Lead.id)).where(
                    Lead.created_at >= since, Lead.status == LeadStatus.BOOKED
                )
            )
            or 0
        )

        self.audit.log_read(None, DataCategory.DASHBOARD, "staff", details={"window_days": days})

        return {
            "window_days": days,
            "appointments": {
                "total": total,
                "completed": completed,
                "cancelled": cancelled,
                "no_shows": no_shows,
                "no_show_rate": _rate(no_shows, total),
                "completion_rate": _rate(completed, total),
            },
            "reminders": {
                "sent_24h": count_events(RetentionEventType.REMINDER_SENT),
                "sent_2h": count_events(RetentionEventType.FINAL_REMINDER_SENT),
            },
            "reviews": {
                "requested": reviews_requested,
                "received": reviews_received,
                "velocity": _rate(reviews_received, reviews_requested),
            },
            "reactivation": {
                "sent": reactivations_sent,
                "rebooked": rebooked,
                "recovery_rate": _rate(rebooked, reactivations_sent),
                "patients_at_risk": at_risk,
            },
            "leads": {
                "total": leads_total,
                "booked": leads_booked,
                "book_rate": _rate(leads_booked, leads_total),
            },
            "generated_at": utcnow().isoformat() + "Z",
        }


# ---------------------------------------------------------------------- #
def _rate(numerator: int, denominator: int) -> float:
    return round((numerator / denominator) * 100, 1) if denominator else 0.0


def _first_name(patient: Optional[Patient]) -> Optional[str]:
    if patient is None or not patient.name:
        return None
    return str(patient.name).strip().split()[0]


def _fallback_review_reply(rating: Optional[int]) -> str:
    """Used when OpenAI is unavailable. Still safe to publish after approval."""
    if rating is not None and rating <= 3:
        return (
            f"Thank you for the honest feedback — we're sorry this visit fell short of what we "
            f"aim for. Please reach out to our clinic manager at {settings.clinic_phone or 'the clinic'} "
            "so we can make it right."
        )
    return (
        f"Thank you so much for the kind words! The whole team at {settings.clinic_name} "
        "appreciates you taking the time, and we look forward to seeing you again."
    )


__all__ = ["RetentionService"]
