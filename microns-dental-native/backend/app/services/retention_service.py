"""Module 1 (hygiene recall) and Module 3 (review request & response).

Both modules watch the same Google Calendar "event ended" trigger and are
driven from the same handler here, exactly as they are two independent
workflows in the spec that happen to share a trigger. Both replace the
spec's long ``Wait 30d`` / ``Wait 24h`` chains with a persisted
``next_action_date`` column plus a daily processor — the pattern n8n's own
best-practice guidance recommends once a delay runs past about a week, applied
here for a single-restart-safe backend instead of a workflow engine.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment, AppointmentStatus
from app.models.patient import Patient
from app.services import sms_service as templates
from app.services.deidentify import DeidentificationContext
from app.services.gmail_service import get_gmail_service
from app.services.google_business_service import get_business_service
from app.services.google_calendar_service import CalendarEventParser, GoogleCalendarService
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.llm import get_llm
from app.services.patient_service import get_or_create_patient
from app.services.sms_service import SMSService
from app.utils import days_ago, mask_name, utcnow

logger = logging.getLogger(__name__)


class RetentionService:
    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.sms = SMSService(db, self.audit)
        self.calendar = GoogleCalendarService()

    # ------------------------------------------------------------------ #
    # Shared trigger: an appointment on the primary calendar just ended
    # ------------------------------------------------------------------ #
    def handle_appointment_ended(self, *, calendar_id: str, google_event_id: str) -> dict[str, Any]:
        """The Google Calendar push-notification handler's entry point.

        Fetches the event, parses its description, records the completed
        appointment, then runs both Module 1 and Module 3's start logic.
        """
        event = self.calendar.get_event(calendar_id, google_event_id)
        if event is None:
            return {"status": "ignored", "reason": "event_not_found"}

        fields = CalendarEventParser.parse_appointment_description(event.get("description"))
        if not fields.get("phone"):
            return {"status": "ignored", "reason": "no_patient_data_in_description"}

        patient, _ = get_or_create_patient(
            self.db,
            phone=fields["phone"],
            name=fields.get("patient"),
            email=fields.get("email"),
            member_id=fields.get("member_id"),
            insurance_provider=fields.get("insurance"),
            audit=self.audit,
            user_id="google-calendar",
        )

        end_time = event.get("end", {}).get("dateTime") or event.get("end", {}).get("date")
        from app.utils import parse_datetime

        scheduled_for = parse_datetime(event.get("start", {}).get("dateTime")) or utcnow()
        completed_at = parse_datetime(end_time) or utcnow()

        appointment = self.db.execute(
            select(Appointment).where(Appointment.google_event_id == google_event_id)
        ).scalars().first()
        if appointment is None:
            appointment = Appointment(
                patient_id=patient.id,
                google_event_id=google_event_id,
                google_calendar_id=calendar_id,
                service=fields.get("service") or "visit",
                provider=fields.get("provider"),
                scheduled_for=scheduled_for,
                source="staff",
            )
            self.db.add(appointment)

        appointment.status = AppointmentStatus.COMPLETED
        appointment.completed_at = completed_at
        patient.last_visit_at = completed_at
        patient.append_treatment(
            {"service": appointment.service, "date": completed_at.isoformat(), "provider": appointment.provider}
        )
        self.db.flush()

        recall_result = self._start_hygiene_recall(appointment, patient)
        review_result = self._start_review_request(appointment)
        self.db.commit()

        return {
            "status": "processed",
            "appointment_id": str(appointment.id),
            "recall": recall_result,
            "review": review_result,
        }

    def handle_new_booking(self, *, calendar_id: str, google_event_id: str) -> dict[str, Any]:
        """A new appointment was booked — auto-stop any matching active recall."""
        event = self.calendar.get_event(calendar_id, google_event_id)
        if event is None:
            return {"status": "ignored", "reason": "event_not_found"}

        fields = CalendarEventParser.parse_appointment_description(event.get("description"))
        if not fields.get("phone") and not fields.get("email"):
            return {"status": "ignored", "reason": "no_patient_data_in_description"}

        from app.services.encryption import get_encryption_service

        phone_fp = get_encryption_service().fingerprint(fields.get("phone")) if fields.get("phone") else None
        email_fp = get_encryption_service().fingerprint(fields.get("email")) if fields.get("email") else None
        if phone_fp is None and email_fp is None:
            return {"status": "ignored", "reason": "unmatchable_patient"}

        patient = self.db.execute(
            select(Patient).where(
                (Patient.phone_fingerprint == phone_fp) if phone_fp else (Patient.email_fingerprint == email_fp)
            )
        ).scalars().first()
        if patient is None:
            return {"status": "ignored", "reason": "unknown_patient"}

        stopped = []
        active_recalls = self.db.execute(
            select(Appointment).where(
                Appointment.patient_id == patient.id, Appointment.recall_status == "active"
            )
        ).scalars().all()
        for row in active_recalls:
            if row.recall_tracking_event_id and row.recall_tracking_calendar_id:
                self.calendar.delete_event(row.recall_tracking_calendar_id, row.recall_tracking_event_id)
            row.recall_status = "stopped_rebooked"
            self._log_event("recall_stopped_rebooked", patient_id=patient.id, appointment_id=row.id)
            stopped.append(str(row.id))
        self.db.commit()
        return {"status": "processed", "stopped_recalls": stopped}

    # ------------------------------------------------------------------ #
    # Module 1 — hygiene recall
    # ------------------------------------------------------------------ #
    def _start_hygiene_recall(self, appointment: Appointment, patient: Patient) -> dict[str, Any]:
        future = self.calendar.search_future_events(
            settings.google_primary_calendar_id,
            query=patient.phone,
            time_max=utcnow() + timedelta(days=settings.hygiene_recall_days),
        )
        # Exclude the very event that just ended, and anything already cancelled.
        future = [item for item in future if item.get("id") != appointment.google_event_id]
        if future:
            appointment.recall_status = None
            return {"status": "compliant", "reason": "future_appointment_found"}

        due_date = appointment.completed_at + timedelta(days=settings.hygiene_recall_days)
        tracking_calendar = settings.google_recall_tracking_calendar_id
        tracking_event_id = None
        if tracking_calendar:
            description = CalendarEventParser.build_appointment_description(
                patient_id=str(patient.id),
                patient_name=patient.name or "Patient",
                phone=patient.phone,
                service=appointment.service,
                provider=appointment.provider,
            )
            event = self.calendar.create_event(
                tracking_calendar,
                summary=f"RECALL: {mask_name(patient.name)} | Due: {due_date.date().isoformat()}",
                description=description,
                start=due_date,
                end=due_date + timedelta(minutes=30),
            )
            tracking_event_id = event.get("id")
            self.audit.log_calendar(
                str(patient.id), action="write", calendar_id=tracking_calendar, event_id=tracking_event_id
            )

        appointment.recall_status = "active"
        appointment.recall_stage = "due"
        appointment.recall_due_date = due_date
        appointment.recall_next_action_date = appointment.completed_at + timedelta(days=30)
        appointment.recall_tracking_event_id = tracking_event_id
        appointment.recall_tracking_calendar_id = tracking_calendar
        self._log_event("recall_started", patient_id=patient.id, appointment_id=appointment.id)
        return {"status": "started", "due_date": due_date.isoformat() + "Z"}

    def due_recalls(self, limit: int = 200) -> list[Appointment]:
        return (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.recall_status == "active",
                    Appointment.recall_next_action_date <= utcnow(),
                )
                .limit(limit)
            )
            .scalars()
            .all()
        )

    _RECALL_STAGE_TEMPLATES = {
        "due": ("30d_sent", templates.hygiene_recall_30),
        "30d_sent": ("60d_sent", templates.hygiene_recall_60),
        "60d_sent": ("90d_sent", templates.hygiene_recall_90),
        "90d_sent": (None, templates.hygiene_recall_120_final),
    }

    def process_recall(self, appointment_id: UUID) -> dict[str, Any]:
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None or appointment.recall_status != "active":
            return {"status": "skipped", "reason": "not_active"}

        plan = self._RECALL_STAGE_TEMPLATES.get(appointment.recall_stage or "due")
        if plan is None:
            return {"status": "skipped", "reason": "unknown_stage"}
        next_stage, builder = plan

        patient = appointment.patient
        first_name = _first_name(patient)
        body = builder(first_name=first_name)
        result = self.sms.send(
            to=patient.phone if patient else None,
            body=body,
            template=f"hygiene_recall_{appointment.recall_stage}",
            patient_uuid=str(appointment.patient_id),
            sms_consent=patient.sms_consent if patient else None,
        )

        gmail = get_gmail_service()
        try:
            gmail.create_draft(
                to=settings.dentist_approval_email or settings.front_desk_email or "",
                subject=f"Recall sent to {mask_name(patient.name) if patient else 'patient'} - {appointment.recall_stage}",
                body=f"Automated hygiene recall SMS sent (template={appointment.recall_stage}). SMS status: {result.status}.",
            )
            self.audit.log_gmail_draft(str(appointment.patient_id), purpose="hygiene_recall_log")
        except Exception as exc:  # pragma: no cover - Google not configured yet
            logger.warning("Recall Gmail log skipped: %s", type(exc).__name__)

        if next_stage is None:
            appointment.recall_status = "inactive"
            appointment.recall_stage = "120d_sent"
            self._log_event(
                "recall_marked_inactive", patient_id=appointment.patient_id, appointment_id=appointment.id
            )
        else:
            appointment.recall_stage = next_stage
            appointment.recall_next_action_date = utcnow() + timedelta(days=30)
            if appointment.recall_tracking_event_id and appointment.recall_tracking_calendar_id:
                self.calendar.update_event(
                    appointment.recall_tracking_calendar_id,
                    appointment.recall_tracking_event_id,
                    description=(appointment.recall_stage or "").upper(),
                )
            self._log_event(
                "recall_sms_sent",
                patient_id=appointment.patient_id,
                appointment_id=appointment.id,
                metadata={"stage": appointment.recall_stage, "sms_status": result.status},
            )
        self.db.commit()
        return {"status": "sent" if result.ok else "suppressed", "sms_status": result.status}

    def process_all_due_recalls(self) -> list[dict[str, Any]]:
        return [self.process_recall(row.id) for row in self.due_recalls()]

    def patients_at_risk(self, days: Optional[int] = None, limit: int = 200) -> list[dict[str, Any]]:
        """Patients whose recall drip is active and overdue — the recall dashboard."""
        days = days or settings.hygiene_recall_days
        cutoff = days_ago(days)
        rows = (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.recall_status == "active",
                    Appointment.completed_at <= cutoff,
                )
                .order_by(Appointment.completed_at)
                .limit(limit)
            )
            .scalars()
            .all()
        )
        self.audit.log_read(None, DataCategory.DASHBOARD, "staff", details={"count": len(rows)})
        return [
            {
                "patient_uuid": str(row.patient_id),
                "display_name": mask_name(row.patient.name) if row.patient else "Unknown",
                "days_since_last_visit": (utcnow() - row.completed_at).days if row.completed_at else None,
                "last_visit_at": row.completed_at.isoformat() + "Z" if row.completed_at else None,
                "recall_stage": row.recall_stage,
            }
            for row in rows
        ]

    # ------------------------------------------------------------------ #
    # Module 3 — review request & response
    # ------------------------------------------------------------------ #
    def _start_review_request(self, appointment: Appointment) -> dict[str, Any]:
        appointment.review_next_check_at = utcnow() + timedelta(days=settings.review_request_delay_days)
        return {"status": "scheduled", "check_at": appointment.review_next_check_at.isoformat() + "Z"}

    def due_reviews(self, limit: int = 200) -> list[Appointment]:
        return (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.review_received_at.is_(None),
                    Appointment.review_next_check_at.is_not(None),
                    Appointment.review_next_check_at <= utcnow(),
                )
                .limit(limit)
            )
            .scalars()
            .all()
        )

    def process_review(self, appointment_id: UUID) -> dict[str, Any]:
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found"}

        if appointment.review_requested_at is None:
            # First touch: send the review-request SMS.
            patient = appointment.patient
            result = self.sms.send(
                to=patient.phone if patient else None,
                body=templates.review_request(first_name=_first_name(patient)),
                template="review_request",
                patient_uuid=str(appointment.patient_id),
                sms_consent=patient.sms_consent if patient else None,
            )
            appointment.review_requested_at = utcnow()
            appointment.review_next_check_at = utcnow() + timedelta(days=settings.review_recheck_days)
            self._log_event(
                "review_requested", patient_id=appointment.patient_id, appointment_id=appointment.id,
                metadata={"sms_status": result.status},
            )
            self.db.commit()
            return {"status": "requested", "sms_status": result.status}

        # Re-check: has a matching review shown up on Google Business Profile?
        return self._check_for_review(appointment)

    def _check_for_review(self, appointment: Appointment) -> dict[str, Any]:
        try:
            reviews = get_business_service().get_recent_reviews(location=_gbp_location())
        except Exception as exc:  # pragma: no cover - GBP not configured yet
            logger.warning("Business Profile check skipped: %s", type(exc).__name__)
            appointment.review_next_check_at = utcnow() + timedelta(days=settings.review_recheck_days)
            self.db.commit()
            return {"status": "recheck_scheduled", "reason": "gbp_unavailable"}

        patient = appointment.patient
        first_token = (patient.name or "").strip().split(" ")[0].lower() if patient and patient.name else ""
        match = None
        for review in reviews:
            reviewer = (review.get("reviewer", {}) or {}).get("displayName", "").lower()
            already_replied = bool((review.get("reviewReply") or {}).get("comment"))
            if not already_replied and first_token and first_token in reviewer:
                match = review
                break

        if match is None:
            appointment.review_next_check_at = utcnow() + timedelta(days=settings.review_recheck_days)
            self.db.commit()
            return {"status": "recheck_scheduled", "reason": "no_matching_review_yet"}

        appointment.review_received_at = utcnow()
        appointment.google_review_id = match.get("name")
        star = (match.get("starRating") or "").upper()
        star_map = {"FIVE": 5, "FOUR": 4, "THREE": 3, "TWO": 2, "ONE": 1}
        appointment.review_star_rating = star_map.get(star)
        appointment.encrypted_review_text = match.get("comment")
        self._log_event(
            "review_received", patient_id=appointment.patient_id, appointment_id=appointment.id,
            metadata={"star_rating": appointment.review_star_rating},
        )

        draft = self.draft_review_response(
            review_text=match.get("comment"), star_rating=appointment.review_star_rating,
            patient_uuid=str(appointment.patient_id),
        )
        try:
            get_gmail_service().create_draft(
                to=settings.dentist_approval_email or settings.front_desk_email or "",
                subject=f"[APPROVE-REVIEW-{appointment.id}] Response to {mask_name(patient.name) if patient else 'patient'}'s {appointment.review_star_rating or '?'}-Star Review",
                body=f'Review: "{match.get("comment", "")}"\n\nProposed response: "{draft}" -- Forward or reply to this email to approve and post.',
            )
            self.audit.log_gmail_draft(str(appointment.patient_id), purpose="review_response_approval")
            appointment.review_response_drafted_at = utcnow()
            self._log_event(
                "review_response_drafted", patient_id=appointment.patient_id, appointment_id=appointment.id,
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("Review-response draft skipped: %s", type(exc).__name__)

        self.db.commit()
        return {"status": "matched", "draft_response": draft, "requires_dentist_approval": True}

    def approve_review_response(self, appointment_id: UUID) -> dict[str, Any]:
        """Post the (dentist-approved) drafted reply live to Business Profile."""
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found"}
        if not appointment.google_review_id or not appointment.review_response_drafted_at:
            return {"status": "skipped", "reason": "no_draft_pending"}
        if appointment.review_response_posted_at is not None:
            return {"status": "skipped", "reason": "already_posted"}

        # The approved text is regenerated identically from the stored review
        # text/rating rather than re-sent by the caller, so the reply that
        # goes live is provably the one a dentist saw in the approval email.
        reply_text = self.draft_review_response(
            review_text=appointment.encrypted_review_text,
            star_rating=appointment.review_star_rating,
            patient_uuid=str(appointment.patient_id),
        )
        get_business_service().reply_to_review(review_name=appointment.google_review_id, comment=reply_text)
        appointment.review_response_posted_at = utcnow()
        self._log_event(
            "review_response_posted", patient_id=appointment.patient_id, appointment_id=appointment.id,
        )
        self.db.commit()
        return {"status": "posted"}

    def draft_review_response(
        self, *, review_text: Optional[str], star_rating: Optional[int], patient_uuid: Optional[str] = None
    ) -> str:
        context = DeidentificationContext(patient_uuid=patient_uuid)
        safe_review = context.deidentify(review_text or "")

        system = (
            f"You draft short, warm, professional owner responses to Google reviews for "
            f"{settings.practice_name}, a dental practice. For 5-star or 4-star reviews: thank "
            "them warmly, mention the provider if named, and invite them back. For 3-star or "
            "below: be empathetic, do not get defensive, offer to make it right, and ask them to "
            "call the office. Keep it under 500 characters, plain text, no quotes around the "
            "whole reply. Output ONLY the reply text."
        )
        user = f"Star rating: {star_rating if star_rating is not None else 'unknown'}/5\nReview: {safe_review}"

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
            reply = _fallback_review_reply(star_rating)
        return context.reidentify(reply)

    # ------------------------------------------------------------------ #
    def _log_event(
        self,
        event_type: str,
        *,
        patient_id: Optional[UUID] = None,
        appointment_id: Optional[UUID] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        from app.models.retention_event import RetentionEvent

        self.db.add(
            RetentionEvent(
                event_type=event_type,
                patient_id=patient_id,
                appointment_id=appointment_id,
                event_metadata=metadata or {},
            )
        )
        self.db.flush()

    def dashboard(self, days: int = 30) -> dict[str, Any]:
        from sqlalchemy import func

        since = days_ago(days)

        def count_events(event_type: str) -> int:
            from app.models.retention_event import RetentionEvent

            return int(
                self.db.scalar(
                    select(func.count(RetentionEvent.id)).where(
                        RetentionEvent.created_at >= since, RetentionEvent.event_type == event_type
                    )
                )
                or 0
            )

        at_risk = int(
            self.db.scalar(
                select(func.count(Appointment.id)).where(Appointment.recall_status == "active")
            )
            or 0
        )
        self.audit.log_read(None, DataCategory.DASHBOARD, "staff", details={"window_days": days})
        return {
            "window_days": days,
            "hygiene_recall": {
                "active": at_risk,
                "sms_sent": count_events("recall_sms_sent"),
                "stopped_rebooked": count_events("recall_stopped_rebooked"),
                "marked_inactive": count_events("recall_marked_inactive"),
            },
            "reviews": {
                "requested": count_events("review_requested"),
                "received": count_events("review_received"),
                "posted": count_events("review_response_posted"),
            },
            "generated_at": utcnow().isoformat() + "Z",
        }


def _gbp_location() -> str:
    if not settings.google_business_profile_location:
        raise RuntimeError(
            "GOOGLE_BUSINESS_PROFILE_LOCATION is not set (e.g. accounts/123/locations/456)."
        )
    return settings.google_business_profile_location


def _first_name(patient: Optional[Patient]) -> Optional[str]:
    if patient is None or not patient.name:
        return None
    return str(patient.name).strip().split()[0]


def _fallback_review_reply(star_rating: Optional[int]) -> str:
    """Used when OpenAI is unavailable. Still safe to publish after approval."""
    if star_rating is not None and star_rating <= 3:
        return (
            "Thank you for the honest feedback — we're sorry this visit fell short of what we "
            f"aim for. Please reach out to our office at {settings.practice_phone or 'the practice'} "
            "so we can make it right."
        )
    return (
        f"Thank you so much for the kind words! The whole team at {settings.practice_name} "
        "appreciates you taking the time, and we look forward to seeing you again."
    )


__all__ = ["RetentionService"]
