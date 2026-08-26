"""Module 2 — treatment-plan follow-up (Gmail approval flow).

A consultation ends with a plan presented but unscheduled; this drips a
1/3/7/14/30-day SMS sequence, but **never sends anything a dentist has not
personally approved**. Each stage: an AI agent drafts the SMS copy, a Gmail
draft asks the dentist to forward/reply to approve, a polling job (see
``routers/internal.py``) detects the approval and Twilio sends the *exact*
drafted text — never a re-generated one.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment
from app.models.patient import Patient
from app.models.treatment_plan import TreatmentPlan, TreatmentPlanStage, TreatmentPlanStatus
from app.services.deidentify import DeidentificationContext
from app.services.gmail_service import get_gmail_service
from app.services.google_calendar_service import CalendarEventParser, GoogleCalendarService
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.llm import get_llm
from app.services.notifier import notify_treatment_plan_converted
from app.services.patient_service import get_or_create_patient
from app.services.sms_service import SMSService
from app.utils import mask_name, utcnow

logger = logging.getLogger(__name__)

#: One system prompt per stage — the tone the spec calls for at each touch.
_STAGE_PROMPTS = {
    TreatmentPlanStage.PRESENTED: (
        "This is Day 1 after a treatment plan was presented but not scheduled: focus on "
        "financing options being available."
    ),
    TreatmentPlanStage.DAY1_SENT: (
        "This is Day 3: gently handle common objections (insurance coverage, cost, fear of the "
        "procedure) and reassure the patient."
    ),
    TreatmentPlanStage.DAY3_SENT: (
        "This is Day 7: include a brief testimonial-style social-proof line (generic, no real "
        "names) to build trust."
    ),
    TreatmentPlanStage.DAY7_SENT: (
        "This is Day 14: offer a limited-time scheduling incentive, creating gentle urgency "
        "without being pushy."
    ),
    TreatmentPlanStage.DAY14_SENT: (
        "This is the final Day 30 message: ask directly and warmly what is preventing the "
        "patient from scheduling, inviting them to reply with any concern."
    ),
}

_DAY_LABEL = {
    TreatmentPlanStage.PRESENTED: "DAY1",
    TreatmentPlanStage.DAY1_SENT: "DAY3",
    TreatmentPlanStage.DAY3_SENT: "DAY7",
    TreatmentPlanStage.DAY7_SENT: "DAY14",
    TreatmentPlanStage.DAY14_SENT: "DAY30",
}


class TreatmentPlanService:
    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.sms = SMSService(db, self.audit)
        self.calendar = GoogleCalendarService()

    # ------------------------------------------------------------------ #
    # Start — a consultation ends with TP_SCHEDULED: NO
    # ------------------------------------------------------------------ #
    def handle_consultation_ended(self, *, calendar_id: str, google_event_id: str) -> dict[str, Any]:
        event = self.calendar.get_event(calendar_id, google_event_id)
        if event is None:
            return {"status": "ignored", "reason": "event_not_found"}

        fields = CalendarEventParser.parse_appointment_description(event.get("description"))
        if fields.get("tp_scheduled") is not False:
            return {"status": "ignored", "reason": "no_unscheduled_treatment_plan"}
        if not fields.get("phone"):
            return {"status": "ignored", "reason": "no_patient_data_in_description"}

        patient, _ = get_or_create_patient(
            self.db, phone=fields["phone"], name=fields.get("patient"), email=fields.get("email"),
            audit=self.audit, user_id="google-calendar",
        )

        from app.utils import parse_datetime

        presentation_date = parse_datetime(event.get("end", {}).get("dateTime")) or utcnow()
        plan = self.create_plan(
            patient_id=patient.id,
            procedures=[{"description": fields.get("treatment_plan") or "Treatment plan"}],
            total_value_cents=fields.get("tp_value_cents") or 0,
            presentation_date=presentation_date,
        )
        return {"status": "started", "treatment_plan_id": str(plan.id)}

    def handle_new_booking_event(self, *, calendar_id: str, google_event_id: str) -> list[dict[str, Any]]:
        """A new appointment appeared on the calendar — close any open plan for that patient."""
        event = self.calendar.get_event(calendar_id, google_event_id)
        if event is None:
            return []
        fields = CalendarEventParser.parse_appointment_description(event.get("description"))
        if not fields.get("phone"):
            return []

        from app.services.encryption import get_encryption_service
        from app.models.patient import Patient

        phone_fp = get_encryption_service().fingerprint(fields["phone"])
        patient = self.db.execute(select(Patient).where(Patient.phone_fingerprint == phone_fp)).scalars().first()
        if patient is None:
            return []
        return self.handle_booking(patient_id=patient.id)

    def create_plan(
        self,
        *,
        patient_id: UUID,
        procedures: list[dict[str, Any]],
        total_value_cents: int,
        presentation_date,
        appointment_id: Optional[UUID] = None,
    ) -> TreatmentPlan:
        day1_date = presentation_date + timedelta(days=1)
        plan = TreatmentPlan(
            patient_id=patient_id,
            procedures=procedures,
            total_value_cents=total_value_cents,
            presentation_date=presentation_date,
            stage=TreatmentPlanStage.PRESENTED,
            status=TreatmentPlanStatus.ACTIVE,
            next_action_date=day1_date,
            approval_tag=uuid.uuid4().hex[:12],
        )
        self.db.add(plan)
        self.db.flush()

        if appointment_id is not None:
            appointment = self.db.get(Appointment, appointment_id)
            if appointment is not None:
                appointment.treatment_plan_id = plan.id

        tracking_calendar = settings.google_treatment_plan_calendar_id
        if tracking_calendar:
            patient = self.db.get(Patient, patient_id)
            description = (
                f"Day 1: {day1_date.date().isoformat()} | Value: "
                f"${total_value_cents / 100:,.2f} | Plan: {procedures}"
            )
            event = self.calendar.create_event(
                tracking_calendar,
                summary=(
                    f"TP FOLLOW-UP: {mask_name(patient.name) if patient else 'Patient'} | "
                    f"Value: ${total_value_cents / 100:,.2f} | Presented: {presentation_date.date().isoformat()}"
                ),
                description=description,
                start=day1_date,
                end=day1_date + timedelta(minutes=30),
            )
            plan.google_tracking_event_id = event.get("id")
            plan.google_tracking_calendar_id = tracking_calendar

        self._log_event("tp_started", patient_id=patient_id, treatment_plan_id=plan.id)
        self.db.commit()
        return plan

    # ------------------------------------------------------------------ #
    # Daily processor — draft the next stage's SMS for dentist approval
    # ------------------------------------------------------------------ #
    def due_plans(self, limit: int = 200) -> list[TreatmentPlan]:
        return (
            self.db.execute(
                select(TreatmentPlan)
                .where(
                    TreatmentPlan.status == TreatmentPlanStatus.ACTIVE,
                    TreatmentPlan.next_action_date <= utcnow(),
                )
                .limit(limit)
            )
            .scalars()
            .all()
        )

    def process_plan(self, treatment_plan_id: UUID) -> dict[str, Any]:
        plan = self.db.get(TreatmentPlan, treatment_plan_id)
        if plan is None or plan.status != TreatmentPlanStatus.ACTIVE:
            return {"status": "skipped", "reason": "not_active"}

        patient = self.db.get(Patient, plan.patient_id)
        prompt = _STAGE_PROMPTS.get(plan.stage)
        if prompt is None:
            return {"status": "skipped", "reason": "terminal_stage"}

        procedures_text = ", ".join(
            str(item.get("description", item)) for item in (plan.procedures or [])
        ) or "your treatment plan"
        context = DeidentificationContext(patient_uuid=str(plan.patient_id))
        context.register_name(patient.name if patient else None)

        system = (
            "You write short SMS messages (under 320 characters, plain text, no quotes) for a "
            f"dental practice follow-up sequence. {prompt} Sign off implying the practice, use "
            "[Booking Link] as a literal placeholder for the booking link. Output ONLY the SMS "
            "text, nothing else."
        )
        user = context.deidentify(
            f"Patient: {patient.name if patient else 'the patient'}. Treatment plan: "
            f"{procedures_text}, value ${plan.total_value_cents / 100:,.2f}. Write the SMS."
        )
        sms_text = get_llm().complete_text(
            system=system, user=user, purpose="tp_followup_sms_draft",
            temperature=0.6, max_tokens=200, audit=self.audit, patient_uuid=str(plan.patient_id),
        )
        if not sms_text:
            sms_text = (
                f"Hi{' ' + patient.name.split()[0] if patient and patient.name else ''}, just "
                "checking in about your treatment plan — happy to answer any questions. "
                "Book here: [Booking Link]"
            )
        sms_text = context.reidentify(sms_text)

        day_label = _DAY_LABEL.get(plan.stage, "DAY?")
        try:
            get_gmail_service().create_draft(
                to=settings.dentist_approval_email or settings.front_desk_email or "",
                subject=f"[APPROVE-TP-{plan.approval_tag}] {day_label} TP Follow-up for {mask_name(patient.name) if patient else 'patient'}",
                body=f'Proposed SMS: "{sms_text}" -- Forward or reply to this email to approve and send as-is.',
            )
            self.audit.log_gmail_draft(str(plan.patient_id), purpose="tp_followup_approval")
        except Exception as exc:  # pragma: no cover - Google not configured yet
            logger.warning("TP follow-up Gmail draft skipped: %s", type(exc).__name__)

        plan.set_pending_sms_text(sms_text)
        plan.status = TreatmentPlanStatus.AWAITING_APPROVAL
        self._log_event(
            "tp_sms_drafted", patient_id=plan.patient_id, treatment_plan_id=plan.id,
            metadata={"stage": plan.stage},
        )
        self.db.commit()
        return {"status": "drafted", "stage": plan.stage, "approval_tag": plan.approval_tag}

    def process_all_due_plans(self) -> list[dict[str, Any]]:
        return [self.process_plan(plan.id) for plan in self.due_plans()]

    # ------------------------------------------------------------------ #
    # Approval — dentist forwarded/replied to the draft
    # ------------------------------------------------------------------ #
    def approve_by_tag(self, approval_tag: str) -> dict[str, Any]:
        plan = self.db.execute(
            select(TreatmentPlan).where(TreatmentPlan.approval_tag == approval_tag)
        ).scalars().first()
        if plan is None:
            return {"status": "not_found"}
        if plan.status != TreatmentPlanStatus.AWAITING_APPROVAL:
            return {"status": "skipped", "reason": "stale_or_already_processed"}

        patient = self.db.get(Patient, plan.patient_id)
        result = self.sms.send(
            to=patient.phone if patient else None,
            body=plan.pending_sms_text or "",
            template="tp_followup_approved",
            patient_uuid=str(plan.patient_id),
            sms_consent=patient.sms_consent if patient else None,
        )

        next_stage = TreatmentPlanStage.next_stage(plan.stage)
        plan.set_pending_sms_text(None)
        if next_stage is None:
            # DAY30_SENT was just approved and sent — no more stages after this.
            plan.status = TreatmentPlanStatus.EXPIRED
            plan.expired_at = utcnow()
            plan.next_action_date = None
            self._notify_expired(plan, patient)
            self._log_event("tp_expired", patient_id=plan.patient_id, treatment_plan_id=plan.id)
        else:
            plan.stage = next_stage
            plan.status = TreatmentPlanStatus.ACTIVE
            plan.followup_count += 1
            offset = TreatmentPlanStage.OFFSET_DAYS.get(plan.stage, 30)
            plan.next_action_date = plan.presentation_date + timedelta(days=offset)

        self._log_event(
            "tp_sms_approved_sent", patient_id=plan.patient_id, treatment_plan_id=plan.id,
            metadata={"sms_status": result.status},
        )
        self.db.commit()
        return {"status": "sent" if result.ok else "suppressed", "sms_status": result.status}

    def _notify_expired(self, plan: TreatmentPlan, patient: Optional[Patient]) -> None:
        try:
            get_gmail_service().create_draft(
                to=settings.dentist_approval_email or settings.front_desk_email or "",
                subject=f"EXPIRED: Treatment plan for {mask_name(patient.name) if patient else 'patient'} - ${plan.total_value_cents / 100:,.2f} lost",
                body=(
                    f"{mask_name(patient.name) if patient else 'The patient'} never scheduled their "
                    f"treatment plan (${plan.total_value_cents / 100:,.2f}) after 30+ days of "
                    "follow-up. Consider a personal call."
                ),
            )
            self.audit.log_gmail_draft(str(plan.patient_id), purpose="tp_expired_notice")
        except Exception as exc:  # pragma: no cover
            logger.warning("TP-expired notice skipped: %s", type(exc).__name__)

    # ------------------------------------------------------------------ #
    # Conversion — the patient booked anyway
    # ------------------------------------------------------------------ #
    def handle_booking(self, *, patient_id: UUID) -> list[dict[str, Any]]:
        """A new appointment was booked for this patient — close any open plan."""
        plans = self.db.execute(
            select(TreatmentPlan).where(
                TreatmentPlan.patient_id == patient_id,
                TreatmentPlan.status.in_((TreatmentPlanStatus.ACTIVE, TreatmentPlanStatus.AWAITING_APPROVAL)),
            )
        ).scalars().all()
        results = []
        for plan in plans:
            plan.status = TreatmentPlanStatus.CONVERTED
            plan.converted_at = utcnow()
            plan.scheduled_date = utcnow()
            self._log_event("tp_converted", patient_id=patient_id, treatment_plan_id=plan.id)
            notify_treatment_plan_converted(plan)
            try:
                patient = self.db.get(Patient, patient_id)
                get_gmail_service().create_draft(
                    to=settings.dentist_approval_email or settings.front_desk_email or "",
                    subject=f"TP CONVERTED: {mask_name(patient.name) if patient else 'Patient'} - ${plan.total_value_cents / 100:,.2f} recovered",
                    body=(
                        f"{mask_name(patient.name) if patient else 'The patient'} booked an "
                        f"appointment and their treatment plan (value ${plan.total_value_cents / 100:,.2f}) "
                        "is now marked CONVERTED."
                    ),
                )
            except Exception as exc:  # pragma: no cover
                logger.warning("TP-converted notice skipped: %s", type(exc).__name__)
            results.append({"treatment_plan_id": str(plan.id), "status": "converted"})
        if results:
            self.db.commit()
        return results

    def list_active(self, limit: int = 200) -> list[dict[str, Any]]:
        rows = self.db.execute(
            select(TreatmentPlan)
            .where(TreatmentPlan.status.in_((TreatmentPlanStatus.ACTIVE, TreatmentPlanStatus.AWAITING_APPROVAL)))
            .order_by(TreatmentPlan.next_action_date)
            .limit(limit)
        ).scalars().all()
        self.audit.log_read(None, DataCategory.TREATMENT_PLAN, "staff", details={"count": len(rows)})
        return [row.as_dict() for row in rows]

    def _log_event(
        self, event_type: str, *, patient_id: UUID, treatment_plan_id: UUID, metadata: Optional[dict] = None
    ) -> None:
        from app.models.retention_event import RetentionEvent

        self.db.add(
            RetentionEvent(
                event_type=event_type,
                patient_id=patient_id,
                treatment_plan_id=treatment_plan_id,
                event_metadata=metadata or {},
            )
        )
        self.db.flush()


__all__ = ["TreatmentPlanService"]
