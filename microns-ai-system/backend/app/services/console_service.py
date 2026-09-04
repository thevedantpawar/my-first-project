"""Read-only projections for the owner console.

Everything in this module is a *view* over rows the engine already writes. It
starts no workflows, sends no messages and stores nothing. When the console
needs to act, it calls the existing endpoints in ``routers/retention.py`` and
``routers/appointments.py``; nothing here duplicates that logic.

Two rules shape the whole file:

**Nothing is invented.** Every number returned traces to a column. Revenue is
summed from ``Appointment.price_cents`` and reports how many rows actually
carry a price, so the console can say "9 of 34 appointments have a recorded
value" instead of implying it knows the other 25. Where the engine has no
data, the field is ``None`` and the UI says so.

**Nothing identifies a patient.** Names arrive masked ("Jane D."), phones as
last-four, and everything else is a UUID. This is the same contract
``LeadService.lead_view`` already honours.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from pathlib import Path
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.lead import Lead, LeadStatus, LeadTemperature
from app.models.patient import Patient
from app.models.retention_event import RetentionEvent, RetentionEventType
from app.models.voice_call import VoiceCall, VoiceCallOutcome
from app.services import demo_service, pricing_service
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.retention_service import RetentionService
from app.utils import days_ago, mask_name, mask_phone, utcnow

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------- #
# Opportunity taxonomy
#
# Each entry maps a real query result onto the three things an owner needs to
# read in one glance: what happened, why it matters, what to do about it. The
# copy is fixed and business-facing; the numbers come from the row.
# --------------------------------------------------------------------- #
OPPORTUNITY_KINDS = {
    "high_intent_lead": {
        "label": "High-intent lead",
        "tone": "urgent",
        "why": "Scored hot by the qualification engine and still unbooked.",
    },
    "warm_lead": {
        "label": "Lead follow-up",
        "tone": "attention",
        "why": "Qualified for staff follow-up within 24 hours.",
    },
    "no_show": {
        "label": "No-show recovery",
        "tone": "urgent",
        "why": "A booked slot went unused. Rebooking recovers the visit.",
    },
    "dormant": {
        "label": "Dormant client",
        "tone": "info",
        "why": f"No visit in {settings.reactivation_days}+ days and nothing on the calendar.",
    },
    "review": {
        "label": "Review request",
        "tone": "info",
        "why": "Treatment completed and the review window is open.",
    },
    "callback": {
        "label": "Needs your team",
        "tone": "urgent",
        "why": "The phone agent promised a provider callback within 2 hours.",
    },
    "unconfirmed": {
        "label": "Unconfirmed booking",
        "tone": "attention",
        "why": "Booked by the phone agent and held pending front-desk confirmation.",
    },
}


class ConsoleService:
    """Composes the owner-facing views. Read-only by construction."""

    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.retention = RetentionService(db, self.audit)

    # ------------------------------------------------------------------ #
    # Overview
    # ------------------------------------------------------------------ #
    def overview(self, days: int = 30, user: str = "staff") -> dict[str, Any]:
        """Headline numbers for the dashboard.

        Wraps ``RetentionService.dashboard`` — the same aggregate the engine
        has always exposed — and adds the counts the console renders next to
        it. One request instead of six.
        """
        dashboard = self.retention.dashboard(days=days)
        since = days_ago(days)
        now = utcnow()

        leads_by_temperature = dict(
            self.db.execute(
                select(Lead.temperature, func.count(Lead.id))
                .where(Lead.created_at >= since, Lead.temperature.is_not(None))
                .group_by(Lead.temperature)
            ).all()
        )

        calls_total = self._count(select(func.count(VoiceCall.id)).where(VoiceCall.created_at >= since))
        calls_booked = self._count(
            select(func.count(VoiceCall.id)).where(
                VoiceCall.created_at >= since, VoiceCall.outcome == VoiceCallOutcome.BOOKED
            )
        )
        calls_escalated = self._count(
            select(func.count(VoiceCall.id)).where(
                VoiceCall.created_at >= since,
                VoiceCall.outcome.in_((VoiceCallOutcome.CALLBACK_REQUESTED, VoiceCallOutcome.TRANSFERRED)),
            )
        )

        appointments_today = self._count(
            select(func.count(Appointment.id)).where(
                Appointment.scheduled_for >= now.replace(hour=0, minute=0, second=0, microsecond=0),
                Appointment.scheduled_for < now.replace(hour=0, minute=0, second=0, microsecond=0)
                + timedelta(days=1),
            )
        )
        ai_booked = self._count(
            select(func.count(Appointment.id)).where(
                Appointment.created_at >= since,
                Appointment.source.in_(
                    (AppointmentSource.VOICE, AppointmentSource.WEB, AppointmentSource.SMS)
                ),
            )
        )
        booked_total = self._count(
            select(func.count(Appointment.id)).where(Appointment.created_at >= since)
        )

        messages_sent = sum(
            self._count(
                select(func.count(RetentionEvent.id)).where(
                    RetentionEvent.created_at >= since, RetentionEvent.event_type == event_type
                )
            )
            for event_type in (
                RetentionEventType.REMINDER_SENT,
                RetentionEventType.FINAL_REMINDER_SENT,
                RetentionEventType.REACTIVATION_SENT,
                RetentionEventType.CREDIT_OFFER_SENT,
                RetentionEventType.REVIEW_REQUESTED,
                RetentionEventType.NURTURE_SENT,
            )
        )

        self.audit.log_read(None, DataCategory.DASHBOARD, user, details={"view": "overview"})

        return {
            "window_days": days,
            "clinic": {
                "name": settings.clinic_name,
                "timezone": settings.clinic_timezone,
                "environment": settings.environment,
            },
            "engine": dashboard,
            "leads": {
                **dashboard["leads"],
                "hot": leads_by_temperature.get(LeadTemperature.HOT, 0),
                "warm": leads_by_temperature.get(LeadTemperature.WARM, 0),
                "cold": leads_by_temperature.get(LeadTemperature.COLD, 0),
            },
            "calls": {
                "total": calls_total,
                "booked": calls_booked,
                "escalated": calls_escalated,
                # Share of calls the agent finished without asking for a human.
                "self_serve_rate": _rate(calls_total - calls_escalated, calls_total),
            },
            "bookings": {
                "today": appointments_today,
                "created": booked_total,
                "ai_assisted": ai_booked,
                "ai_share": _rate(ai_booked, booked_total),
            },
            "messages_sent": messages_sent,
            "trend": {
                "leads": self._movement(Lead, Lead.created_at, days),
                "appointments": self._movement(Appointment, Appointment.created_at, days),
                "calls": self._movement(VoiceCall, VoiceCall.created_at, days),
            },
            "activity": {
                "leads": self._daily_series(Lead, Lead.created_at, min(days, 30)),
                "appointments": self._daily_series(
                    Appointment, Appointment.created_at, min(days, 30)
                ),
            },
            "generated_at": utcnow().isoformat() + "Z",
        }

    # ------------------------------------------------------------------ #
    # Trend and activity, both counted rather than modelled
    # ------------------------------------------------------------------ #
    def _movement(self, model, column, days: int) -> dict[str, Any]:
        """This period against the one immediately before it.

        Returned as ``None`` percentages rather than zeroes when there is
        nothing to compare against: a clinic's first week has no "vs previous
        period", and an arrow pointing at 0% would be an invented claim.
        """
        now = utcnow()
        start = now - timedelta(days=days)
        previous_start = now - timedelta(days=days * 2)

        current = self._count(
            select(func.count(model.id)).where(column >= start, column <= now)
        )
        previous = self._count(
            select(func.count(model.id)).where(column >= previous_start, column < start)
        )

        if previous == 0:
            # No baseline. The UI shows the count with no arrow.
            change = None
        else:
            change = round(((current - previous) / previous) * 100, 1)

        return {
            "current": current,
            "previous": previous,
            "change_percent": change,
            "direction": (
                None if change is None else "up" if change > 0 else "down" if change < 0 else "flat"
            ),
            "comparable": previous > 0,
        }

    def _daily_series(self, model, column, days: int) -> list[dict[str, Any]]:
        """One bucket per day across the window, zero-filled.

        Zero-filled so a quiet Tuesday is a gap in the chart rather than a
        missing point that would flatter the shape.
        """
        now = utcnow()
        start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

        rows = (
            self.db.execute(select(column).where(column >= start, column <= now)).scalars().all()
        )
        buckets: dict[str, int] = {}
        for index in range(days):
            day = (start + timedelta(days=index)).date().isoformat()
            buckets[day] = 0
        for value in rows:
            if value is None:
                continue
            key = value.date().isoformat()
            if key in buckets:
                buckets[key] += 1

        return [{"date": day, "value": count} for day, count in buckets.items()]

    # ------------------------------------------------------------------ #
    # Opportunities
    # ------------------------------------------------------------------ #
    def opportunities(self, limit: int = 60, user: str = "staff") -> list[dict[str, Any]]:
        """Everything the engine has surfaced that is worth a human minute.

        Six real queries, one ranked list. The ranking is by urgency then by
        how long the item has been waiting — a callback past its two-hour
        promise outranks a review request that opened this morning.
        """
        now = utcnow()
        items: list[dict[str, Any]] = []

        # --- Leads awaiting a human ------------------------------------ #
        leads = (
            self.db.execute(
                select(Lead)
                .where(
                    Lead.status.in_((LeadStatus.QUALIFIED, LeadStatus.NURTURE)),
                    Lead.created_at >= days_ago(30),
                )
                .order_by(Lead.qualification_score.desc(), Lead.created_at)
                .limit(50)
            )
            .scalars()
            .all()
        )
        for lead in leads:
            hot = lead.temperature == LeadTemperature.HOT
            waiting_hours = _hours_between(lead.created_at, now)
            items.append(
                {
                    "id": f"lead:{lead.id}",
                    "kind": "high_intent_lead" if hot else "warm_lead",
                    "subject": mask_name(lead.name) or "Anonymous lead",
                    "detail": _treatment_label(lead.treatment_interest),
                    "score": lead.qualification_score,
                    "waiting_hours": waiting_hours,
                    "urgency": 0 if hot else 2,
                    "next_action": (
                        "Provider approval needed before booking"
                        if lead.needs_provider_approval
                        else _lead_next_action(lead)
                    ),
                    "record": {"type": "lead", "id": str(lead.id)},
                    "flags": _lead_flags(lead),
                }
            )

        # --- No-shows that never rebooked ------------------------------- #
        no_shows = (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.status == AppointmentStatus.NO_SHOW,
                    Appointment.scheduled_for >= days_ago(30),
                )
                .order_by(Appointment.scheduled_for.desc())
                .limit(50)
            )
            .scalars()
            .all()
        )
        for appointment in no_shows:
            if self.retention.has_rebooked(appointment):
                continue
            items.append(
                {
                    "id": f"noshow:{appointment.id}",
                    "kind": "no_show",
                    "subject": self._patient_label(appointment.patient),
                    "detail": _treatment_label(appointment.service),
                    "score": None,
                    "waiting_hours": _hours_between(appointment.scheduled_for, now),
                    "urgency": 1,
                    "next_action": (
                        f"Send the ${settings.no_show_credit_amount} rebooking credit"
                        if appointment.reactivation_sent_at is not None
                        else "Send a rebooking message"
                    ),
                    "record": {
                        "type": "appointment",
                        "id": str(appointment.id),
                        "patient_uuid": str(appointment.patient_id),
                    },
                    "flags": (
                        ["Recovery message already sent"]
                        if appointment.reactivation_sent_at is not None
                        else []
                    ),
                }
            )

        # --- Unconfirmed bookings held by the phone agent --------------- #
        pending = (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.status == AppointmentStatus.PENDING,
                    Appointment.scheduled_for >= now,
                )
                .order_by(Appointment.scheduled_for)
                .limit(25)
            )
            .scalars()
            .all()
        )
        for appointment in pending:
            items.append(
                {
                    "id": f"pending:{appointment.id}",
                    "kind": "unconfirmed",
                    "subject": self._patient_label(appointment.patient),
                    "detail": _treatment_label(appointment.service),
                    "score": None,
                    "waiting_hours": _hours_between(appointment.created_at, now),
                    "urgency": 2,
                    "next_action": "Confirm the appointment",
                    "record": {
                        "type": "appointment",
                        "id": str(appointment.id),
                        "patient_uuid": str(appointment.patient_id),
                    },
                    "flags": [f"Booked by {_source_label(appointment.source)}"],
                }
            )

        # --- Clinical callbacks the agent promised ---------------------- #
        callbacks = (
            self.db.execute(
                select(VoiceCall)
                .where(
                    VoiceCall.outcome.in_(
                        (VoiceCallOutcome.CALLBACK_REQUESTED, VoiceCallOutcome.TRANSFERRED)
                    ),
                    VoiceCall.created_at >= days_ago(7),
                )
                .order_by(VoiceCall.created_at)
                .limit(25)
            )
            .scalars()
            .all()
        )
        for call in callbacks:
            waiting = _hours_between(call.created_at, now)
            items.append(
                {
                    "id": f"callback:{call.id}",
                    "kind": "callback",
                    "subject": self._patient_label(call.patient),
                    "detail": "Clinical question from a phone call",
                    "score": None,
                    "waiting_hours": waiting,
                    "urgency": 0,
                    "next_action": "Call back — the agent promised 2 hours",
                    "record": {
                        "type": "call",
                        "id": str(call.id),
                        "patient_uuid": str(call.patient_id) if call.patient_id else None,
                    },
                    "flags": ["Past the 2-hour promise"] if waiting > 2 else [],
                }
            )

        # --- Dormant clients -------------------------------------------- #
        for row in self.retention.patients_at_risk(limit=25):
            items.append(
                {
                    "id": f"dormant:{row['patient_uuid']}",
                    "kind": "dormant",
                    "subject": row["display_name"] or "Client",
                    "detail": (
                        f"Last visit {row['days_since_last_visit']} days ago"
                        if row.get("days_since_last_visit") is not None
                        else "No recorded visit"
                    ),
                    "score": None,
                    "waiting_hours": (row.get("days_since_last_visit") or 0) * 24,
                    "urgency": 3,
                    "next_action": (
                        "Send a reactivation offer"
                        if row.get("marketing_consent")
                        else "No marketing consent on file — call instead"
                    ),
                    "record": {
                        "type": "patient",
                        "id": row["patient_uuid"],
                        "patient_uuid": row["patient_uuid"],
                    },
                    "flags": [] if row.get("marketing_consent") else ["Marketing consent missing"],
                }
            )

        # --- Reviews whose window has opened ---------------------------- #
        reviews = (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.status == AppointmentStatus.COMPLETED,
                    Appointment.completed_at.is_not(None),
                    Appointment.completed_at <= days_ago(settings.review_request_delay_days),
                    Appointment.review_requested_at.is_(None),
                    Appointment.review_received_at.is_(None),
                )
                .order_by(Appointment.completed_at)
                .limit(25)
            )
            .scalars()
            .all()
        )
        for appointment in reviews:
            items.append(
                {
                    "id": f"review:{appointment.id}",
                    "kind": "review",
                    "subject": self._patient_label(appointment.patient),
                    "detail": f"{_treatment_label(appointment.service)} completed",
                    "score": None,
                    "waiting_hours": _hours_between(appointment.completed_at, now),
                    "urgency": 4,
                    "next_action": "Request a review",
                    "record": {
                        "type": "appointment",
                        "id": str(appointment.id),
                        "patient_uuid": str(appointment.patient_id),
                    },
                    "flags": [],
                }
            )

        items.sort(key=lambda item: (item["urgency"], -(item["waiting_hours"] or 0)))
        self.audit.log_read(
            None, DataCategory.DASHBOARD, user, details={"view": "opportunities", "count": len(items)}
        )
        return [_decorate(item) for item in items[:limit]]

    # ------------------------------------------------------------------ #
    # Leads
    # ------------------------------------------------------------------ #
    def leads(
        self,
        *,
        status: Optional[str] = None,
        temperature: Optional[str] = None,
        days: int = 90,
        limit: int = 100,
        user: str = "staff",
    ) -> list[dict[str, Any]]:
        query = (
            select(Lead)
            .where(Lead.created_at >= days_ago(days))
            .order_by(Lead.created_at.desc())
            .limit(limit)
        )
        if status:
            query = query.where(Lead.status == status)
        if temperature:
            query = query.where(Lead.temperature == temperature)

        rows = self.db.execute(query).scalars().all()
        self.audit.log_read(
            None, DataCategory.LEAD_QUALIFICATION, user, details={"count": len(rows)}
        )
        return [self._lead_row(lead) for lead in rows]

    def lead_detail(self, lead_id: UUID, user: str = "staff") -> Optional[dict[str, Any]]:
        lead = self.db.get(Lead, lead_id)
        if lead is None:
            return None

        self.audit.log_read(None, DataCategory.LEAD_QUALIFICATION, user, details={"view": "detail"})
        state = lead.conversation_state or {}
        events = (
            self.db.execute(
                select(RetentionEvent)
                .where(RetentionEvent.lead_id == lead.id)
                .order_by(RetentionEvent.created_at.desc())
                .limit(50)
            )
            .scalars()
            .all()
        )

        return {
            **self._lead_row(lead),
            "answers": {
                "treatment_interest": lead.treatment_interest,
                "previous_experience": lead.previous_experience,
                "is_pregnant": lead.is_pregnant,
                "blood_thinner": lead.blood_thinner,
                "budget_range": lead.budget_range,
                "timeline": lead.timeline,
            },
            "score_breakdown": lead.score_breakdown or {},
            # The engine stores qualification state, not message text. That is
            # a deliberate PHI decision, so the console reports the state and
            # says plainly that no transcript exists rather than rendering an
            # empty thread.
            "conversation": {
                "transcript_retained": False,
                "turns": state.get("turns", 0),
                "currently_asking": _question_label(state.get("asking")),
                "last_reply_at": state.get("last_reply_at"),
                "completed_at": state.get("completed_at"),
            },
            "booking_url": lead.calendly_booking_url,
            "journey": self._lead_journey(lead),
            "events": [_event_row(event) for event in events],
        }

    # ------------------------------------------------------------------ #
    # Conversations
    # ------------------------------------------------------------------ #
    def conversations(self, limit: int = 60, user: str = "staff") -> list[dict[str, Any]]:
        """Chat/SMS qualifications and phone calls, newest first.

        Two different tables, one list — an owner does not think of "leads" and
        "voice_calls", they think of people who got in touch.
        """
        rows: list[dict[str, Any]] = []

        leads = (
            self.db.execute(
                select(Lead).order_by(Lead.updated_at.desc()).limit(limit)
            )
            .scalars()
            .all()
        )
        for lead in leads:
            state = lead.conversation_state or {}
            asking = _question_label(state.get("asking"))
            done = lead.status in (LeadStatus.BOOKED, LeadStatus.DISQUALIFIED)
            rows.append(
                {
                    "id": str(lead.id),
                    "type": "chat" if lead.source != "sms" else "sms",
                    "channel": _source_label(lead.source),
                    "subject": mask_name(lead.name) or "Anonymous",
                    "masked_phone": mask_phone(lead.phone),
                    "intent": _treatment_label(lead.treatment_interest),
                    "temperature": lead.temperature,
                    "score": lead.qualification_score,
                    "status": lead.status,
                    # No message text is stored, so the "preview" is the state
                    # of the qualification rather than a quoted line.
                    "preview": asking or _lead_next_action(lead),
                    "turns": state.get("turns", 0),
                    # The engine never hands a chat to a human automatically;
                    # it either finishes qualification or flags a callback.
                    "handling": (
                        "needs_human"
                        if lead.medical_callback_required or lead.needs_provider_approval
                        else ("closed" if done else "ai")
                    ),
                    "updated_at": _iso(lead.updated_at),
                    "record": {"type": "lead", "id": str(lead.id)},
                }
            )

        calls = (
            self.db.execute(
                select(VoiceCall).order_by(VoiceCall.created_at.desc()).limit(limit)
            )
            .scalars()
            .all()
        )
        for call in calls:
            summary = call.summary or {}
            escalated = call.outcome in (
                VoiceCallOutcome.CALLBACK_REQUESTED,
                VoiceCallOutcome.TRANSFERRED,
            )
            rows.append(
                {
                    "id": str(call.id),
                    "type": "call",
                    "channel": "Phone",
                    "subject": self._patient_label(call.patient),
                    "masked_phone": "",
                    "intent": summary.get("intent") or _outcome_label(call.outcome),
                    "temperature": None,
                    "score": None,
                    "status": call.outcome,
                    "preview": summary.get("handoff_reason") or _outcome_label(call.outcome),
                    "turns": None,
                    "handling": "needs_human" if escalated else "ai",
                    "updated_at": _iso(call.ended_at or call.created_at),
                    "duration_seconds": call.call_duration,
                    "record": {"type": "call", "id": str(call.id)},
                    # The transcript is encrypted PHI. It is deliberately not
                    # exposed here, and the console says so rather than
                    # rendering an empty panel.
                    "transcript_available": bool(call.transcript),
                }
            )

        rows.sort(key=lambda row: row["updated_at"] or "", reverse=True)
        self.audit.log_read(None, DataCategory.DASHBOARD, user, details={"view": "conversations"})
        return rows[:limit]

    # ------------------------------------------------------------------ #
    # Revenue
    # ------------------------------------------------------------------ #
    def revenue(self, days: int = 30, user: str = "staff") -> dict[str, Any]:
        """Revenue attribution, with its own coverage reported alongside it.

        ``price_cents`` is optional on an appointment and most integrations do
        not populate it. Summing it and calling the result "revenue" would be
        a lie of omission, so every total ships with the number of rows that
        actually carried a price. A console that knows the value of 3 of 40
        appointments should say so.

        Attribution is evidence-based, never inferred:

        ``ai_booked``
            ``source`` is voice, web or sms — the row was created by an agent.
        ``recovered_no_show``
            The patient had a no-show, the engine sent a recovery message, and
            a later appointment exists.
        ``reactivated``
            Booked after a dormant-patient reactivation went out.
        ``front_desk``
            Everything else.
        """
        since = days_ago(days)
        rows = (
            self.db.execute(
                select(Appointment).where(Appointment.created_at >= since)
            )
            .scalars()
            .all()
        )

        def empty() -> dict[str, int]:
            return {
                "count": 0,
                "priced_count": 0,
                "complimentary_count": 0,
                "cents": 0,
                "recorded_cents": 0,
                "expected_cents": 0,
            }

        buckets = {
            key: empty()
            for key in ("ai_booked", "recovered_no_show", "reactivated", "front_desk")
        }
        completed = empty()
        scheduled = empty()

        for appointment in rows:
            bucket = buckets[self._attribution(appointment)]
            _accumulate(bucket, appointment)
            if appointment.status == AppointmentStatus.COMPLETED:
                _accumulate(completed, appointment)
            elif appointment.is_active:
                _accumulate(scheduled, appointment)

        # Recovery counts stand on their own even when no price is recorded:
        # "6 appointments recovered" is true whether or not anyone typed a
        # dollar figure into the row.
        recovered_count = buckets["recovered_no_show"]["count"] + buckets["reactivated"]["count"]

        self.audit.log_read(None, DataCategory.DASHBOARD, user, details={"view": "revenue"})

        return {
            "window_days": days,
            "currency": "USD",
            "coverage": {
                "appointments": len(rows),
                "with_recorded_price": sum(bucket["priced_count"] for bucket in buckets.values()),
                # How each priced row came by its figure. When "expected"
                # dominates, the console captions the total as projected
                # value rather than collected revenue.
                "priced_from_booking_system": sum(
                    1
                    for appointment in rows
                    if pricing_service.price_source(appointment)
                    == pricing_service.PRICE_SOURCE_RECORDED
                ),
                "priced_from_price_list": sum(
                    1
                    for appointment in rows
                    if pricing_service.price_source(appointment)
                    == pricing_service.PRICE_SOURCE_EXPECTED
                ),
                # False whenever any row lacks a price — the UI shows a
                # "partial data" note instead of a confident total.
                "complete": all(
                    appointment.price_cents is not None for appointment in rows
                )
                and bool(rows),
            },
            "completed": completed,
            "scheduled": scheduled,
            "attribution": buckets,
            "recovered_appointments": recovered_count,
            "funnel": self._funnel(days),
            "generated_at": utcnow().isoformat() + "Z",
        }

    def _funnel(self, days: int) -> list[dict[str, Any]]:
        """Lead → booked → showed, counted from rows rather than modelled."""
        since = days_ago(days)
        captured = self._count(select(func.count(Lead.id)).where(Lead.created_at >= since))
        engaged = self._count(
            select(func.count(Lead.id)).where(
                Lead.created_at >= since, Lead.status != LeadStatus.NEW
            )
        )
        qualified = self._count(
            select(func.count(Lead.id)).where(
                Lead.created_at >= since,
                Lead.status.in_((LeadStatus.QUALIFIED, LeadStatus.BOOKED)),
            )
        )
        booked = self._count(
            select(func.count(Lead.id)).where(
                Lead.created_at >= since, Lead.status == LeadStatus.BOOKED
            )
        )
        appointments_booked = self._count(
            select(func.count(Appointment.id)).where(Appointment.created_at >= since)
        )
        showed = self._count(
            select(func.count(Appointment.id)).where(
                Appointment.created_at >= since, Appointment.status == AppointmentStatus.COMPLETED
            )
        )
        rebooked = self._count(
            select(func.count(RetentionEvent.id)).where(
                RetentionEvent.created_at >= since,
                RetentionEvent.event_type == RetentionEventType.REBOOKED,
            )
        )

        return [
            {"stage": "Leads captured", "value": captured, "source": "leads"},
            {"stage": "Engaged", "value": engaged, "source": "leads"},
            {"stage": "Qualified", "value": qualified, "source": "leads"},
            {"stage": "Booked", "value": booked, "source": "leads"},
            {"stage": "Appointments created", "value": appointments_booked, "source": "appointments"},
            {"stage": "Showed", "value": showed, "source": "appointments"},
            {"stage": "Rebooked", "value": rebooked, "source": "retention_events"},
        ]

    def _attribution(self, appointment: Appointment) -> str:
        if appointment.source in (
            AppointmentSource.VOICE,
            AppointmentSource.WEB,
            AppointmentSource.SMS,
        ):
            prior_no_show = self._count(
                select(func.count(Appointment.id)).where(
                    Appointment.patient_id == appointment.patient_id,
                    Appointment.id != appointment.id,
                    Appointment.status == AppointmentStatus.NO_SHOW,
                    Appointment.reactivation_sent_at.is_not(None),
                    Appointment.scheduled_for < appointment.created_at,
                )
            )
            if prior_no_show:
                return "recovered_no_show"
            patient = appointment.patient
            if (
                patient is not None
                and patient.reactivation_sent_at is not None
                and patient.reactivation_sent_at <= appointment.created_at
            ):
                return "reactivated"
            return "ai_booked"
        return "front_desk"

    # ------------------------------------------------------------------ #
    # Agents (the three engine modules, described in business terms)
    # ------------------------------------------------------------------ #
    def agents(self, days: int = 30, user: str = "staff") -> list[dict[str, Any]]:
        since = days_ago(days)

        calls = self._count(select(func.count(VoiceCall.id)).where(VoiceCall.created_at >= since))
        calls_booked = self._count(
            select(func.count(VoiceCall.id)).where(
                VoiceCall.created_at >= since, VoiceCall.outcome == VoiceCallOutcome.BOOKED
            )
        )
        calls_escalated = self._count(
            select(func.count(VoiceCall.id)).where(
                VoiceCall.created_at >= since,
                VoiceCall.outcome.in_(
                    (VoiceCallOutcome.CALLBACK_REQUESTED, VoiceCallOutcome.TRANSFERRED)
                ),
            )
        )

        leads_total = self._count(select(func.count(Lead.id)).where(Lead.created_at >= since))
        leads_qualified = self._count(
            select(func.count(Lead.id)).where(
                Lead.created_at >= since,
                Lead.status.in_((LeadStatus.QUALIFIED, LeadStatus.BOOKED)),
            )
        )
        leads_booked = self._count(
            select(func.count(Lead.id)).where(
                Lead.created_at >= since, Lead.status == LeadStatus.BOOKED
            )
        )

        def events(*types: str) -> int:
            return self._count(
                select(func.count(RetentionEvent.id)).where(
                    RetentionEvent.created_at >= since, RetentionEvent.event_type.in_(types)
                )
            )

        reminders = events(RetentionEventType.REMINDER_SENT, RetentionEventType.FINAL_REMINDER_SENT)
        reactivations = events(RetentionEventType.REACTIVATION_SENT, RetentionEventType.CREDIT_OFFER_SENT)
        rebooked = events(RetentionEventType.REBOOKED)
        reviews_requested = events(RetentionEventType.REVIEW_REQUESTED)
        reviews_received = events(RetentionEventType.REVIEW_RECEIVED)

        self.audit.log_read(None, DataCategory.DASHBOARD, user, details={"view": "agents"})

        return [
            {
                "id": "receptionist",
                "name": "AI Receptionist",
                "role": "Your 24/7 digital front desk",
                "description": (
                    "Answers the phone day and night. Books, reschedules and cancels, "
                    "quotes prices, and hands anything clinical to your team."
                ),
                # The agent only exists when VAPI can reach the backend.
                "status": "live" if settings.vapi_webhook_secret else "not_connected",
                "status_detail": (
                    "Connected to the phone system"
                    if settings.vapi_webhook_secret
                    # Owner-facing text: the environment variable that turns
                    # this on belongs in Settings, not on the home screen of
                    # someone who runs a med spa.
                    else "Your phone system isn't connected yet"
                ),
                "metrics": [
                    {"label": "Calls handled", "value": calls},
                    {"label": "Appointments booked", "value": calls_booked},
                    {"label": "Handled without your team", "value": _rate(calls - calls_escalated, calls), "unit": "%"},
                    {"label": "Passed to your team", "value": calls_escalated},
                ],
                "advanced": {
                    "module": "app/routers/voice.py · app/services/voice_service.py",
                    "tools": [
                        "check_availability",
                        "book_appointment",
                        "lookup_appointment",
                        "reschedule_appointment",
                        "cancel_appointment",
                        "get_pricing",
                        "answer_faq",
                        "request_callback",
                    ],
                    "model": settings.llm_model_smart if settings.llm_enabled else "rule engine",
                    "guardrails": [
                        "Never answers a clinical question — routes to a provider callback",
                        "Bookings are created pending, never auto-confirmed",
                        "Transcripts encrypted at rest; prompts de-identified before they leave the process",
                    ],
                },
            },
            {
                "id": "concierge",
                "name": "Lead Concierge",
                "role": "Qualifies every new enquiry in seconds",
                "description": (
                    "Answers website chat and inbound texts, asks the six qualifying "
                    "questions, scores the lead and routes it hot, warm or cold."
                ),
                "status": "live",
                "status_detail": (
                    f"Running on {_PROVIDER_LABELS.get(settings.llm_provider, settings.llm_provider)}"
                    if settings.llm_enabled
                    else "Running on the built-in rule engine (no AI model connected)"
                ),
                "metrics": [
                    {"label": "Leads handled", "value": leads_total},
                    {"label": "Qualified", "value": leads_qualified},
                    {"label": "Booked", "value": leads_booked},
                    {"label": "Booking rate", "value": _rate(leads_booked, leads_total), "unit": "%"},
                ],
                "advanced": {
                    "module": "app/routers/leads.py · app/services/lead_service.py",
                    "tools": ["qualify", "score", "auto_book", "nurture"],
                    "model": settings.llm_model_fast if settings.llm_enabled else "rule engine",
                    "guardrails": [
                        "Pregnancy or breastfeeding disqualifies and books a medical callback",
                        "Blood thinners flag for provider approval without changing the score",
                        "Flow control is deterministic — the model writes language, never decisions",
                    ],
                },
            },
            {
                "id": "recovery",
                "name": "Recovery Specialist",
                "role": "Wins back missed and cancelled visits",
                "description": (
                    "Sends 24-hour and 2-hour reminders, catches no-shows the same day, "
                    "and follows up with a rebooking credit."
                ),
                "status": "live",
                "status_detail": (
                    "Delivering by SMS"
                    if settings.twilio_enabled
                    else "Messages are composed and audited but not delivered — SMS not connected"
                ),
                "metrics": [
                    {"label": "Reminders sent", "value": reminders},
                    {"label": "Recovery messages", "value": reactivations},
                    {"label": "Rebooked", "value": rebooked},
                    {"label": "Recovery rate", "value": _rate(rebooked, reactivations), "unit": "%"},
                ],
                "advanced": {
                    "module": "app/services/retention_service.py",
                    "tools": ["send_reminder", "detect_no_shows", "send_credit_offer"],
                    "model": "deterministic",
                    "guardrails": [
                        "Every send is idempotent — a cron that fires twice texts once",
                        "Reminders are transactional; recovery offers require marketing consent",
                        "Treatment names stay out of SMS unless SMS_INCLUDE_TREATMENT_DETAILS is on",
                    ],
                },
            },
            {
                "id": "reactivation",
                "name": "Reactivation Specialist",
                "role": "Brings dormant clients back",
                "description": (
                    f"Watches for clients with no visit in {settings.reactivation_days}+ days "
                    "and nothing booked, then reaches out with an offer."
                ),
                "status": "live",
                "status_detail": (
                    "Delivering by SMS"
                    if settings.twilio_enabled
                    else "Messages are composed and audited but not delivered — SMS not connected"
                ),
                "metrics": [
                    {"label": "Dormant clients", "value": len(self.retention.patients_at_risk(limit=500))},
                    {"label": "Offers sent", "value": events(RetentionEventType.REACTIVATION_SENT)},
                    {"label": "Nurture messages", "value": events(RetentionEventType.NURTURE_SENT)},
                ],
                "advanced": {
                    "module": "app/services/retention_service.py",
                    "tools": ["send_dormant_reactivation", "send_nurture"],
                    "model": "deterministic",
                    "guardrails": [
                        "30-day cooldown per client",
                        "Marketing consent required; STOP is honoured automatically",
                    ],
                },
            },
            {
                "id": "reviews",
                "name": "Review Assistant",
                "role": "Turns happy visits into public reviews",
                "description": (
                    f"Asks for a review {settings.review_request_delay_days} days after a "
                    "treatment and drafts a reply to the ones that come back."
                ),
                "status": "live",
                "status_detail": (
                    "Delivering by SMS"
                    if settings.twilio_enabled
                    else "Messages are composed and audited but not delivered — SMS not connected"
                ),
                "metrics": [
                    {"label": "Requests sent", "value": reviews_requested},
                    {"label": "Reviews received", "value": reviews_received},
                    {"label": "Response rate", "value": _rate(reviews_received, reviews_requested), "unit": "%"},
                ],
                "advanced": {
                    "module": "app/services/retention_service.py",
                    "tools": ["request_review", "draft_review_response"],
                    "model": settings.llm_model_fast if settings.llm_enabled else "template",
                    "guardrails": [
                        "Review replies are drafted for a human to send, never posted automatically",
                    ],
                },
            },
        ]

    # ------------------------------------------------------------------ #
    # Automations
    # ------------------------------------------------------------------ #
    def workflows(self, user: str = "staff") -> list[dict[str, Any]]:
        """The five orchestration workflows, read from their definitions.

        These run in n8n, which this console cannot see. The activity numbers
        come from the backend's own event log — the actions the workflows
        caused — and the live/paused state is reported as unknown rather than
        guessed at.
        """
        definitions = _load_workflow_definitions()
        since = days_ago(30)

        def events(*types: str) -> int:
            return self._count(
                select(func.count(RetentionEvent.id)).where(
                    RetentionEvent.created_at >= since, RetentionEvent.event_type.in_(types)
                )
            )

        activity = {
            "no_show_prevention": events(
                RetentionEventType.REMINDER_SENT,
                RetentionEventType.FINAL_REMINDER_SENT,
                RetentionEventType.NO_SHOW,
                RetentionEventType.CREDIT_OFFER_SENT,
            ),
            "review_request": events(
                RetentionEventType.REVIEW_REQUESTED, RetentionEventType.REVIEW_RECEIVED
            ),
            "reactivation_sequence": events(RetentionEventType.REACTIVATION_SENT),
            "lead_qualification": self._count(
                select(func.count(Lead.id)).where(Lead.created_at >= since)
            ),
            "voice_handoff": self._count(
                select(func.count(VoiceCall.id)).where(
                    VoiceCall.created_at >= since,
                    VoiceCall.outcome.in_(
                        (VoiceCallOutcome.CALLBACK_REQUESTED, VoiceCallOutcome.TRANSFERRED)
                    ),
                )
            ),
        }

        self.audit.log_read(None, DataCategory.DASHBOARD, user, details={"view": "workflows"})

        out = []
        for definition in definitions:
            key = definition["key"]
            out.append(
                {
                    **definition,
                    "actions_30d": activity.get(key, 0),
                    # n8n owns the on/off switch. Saying "Active" here would be
                    # a guess, so the console reports what it can actually see.
                    "runtime_state": "unknown",
                    "runtime_note": (
                        "Runs in n8n. This console reads the backend actions the "
                        "workflow caused, not n8n's own on/off state."
                    ),
                }
            )
        return out

    # ------------------------------------------------------------------ #
    # Insights
    # ------------------------------------------------------------------ #
    def insights(self, days: int = 30, user: str = "staff") -> list[dict[str, Any]]:
        """Plain-language observations, each carrying the numbers behind it.

        Every insight is a direct read of a count. Nothing here extrapolates,
        forecasts or claims a cause — where a relationship is only a
        correlation the copy says "associated with", and anything the engine
        cannot measure simply produces no insight rather than a guess.
        """
        overview = self.overview(days=days, user=user)
        engine = overview["engine"]
        out: list[dict[str, Any]] = []

        appointments = engine["appointments"]
        if appointments["total"]:
            out.append(
                {
                    "kind": "operations",
                    "headline": f"{appointments['no_show_rate']}% of appointments were missed",
                    "detail": (
                        f"{appointments['no_shows']} of {appointments['total']} appointments in the "
                        f"last {days} days were marked no-show."
                    ),
                    "basis": "Counted from appointment status.",
                    "tone": "attention" if appointments["no_show_rate"] > 10 else "positive",
                }
            )

        unrecovered = sum(
            1
            for item in self.opportunities(limit=200, user=user)
            if item["kind"] == "no_show"
        )
        if unrecovered:
            out.append(
                {
                    "kind": "recovery",
                    "headline": f"{unrecovered} missed appointments remain unrecovered",
                    "detail": "No later booking exists for these clients yet.",
                    "basis": "Appointments with status no_show and no subsequent booking.",
                    "tone": "attention",
                }
            )

        dormant = engine["reactivation"]["patients_at_risk"]
        if dormant:
            out.append(
                {
                    "kind": "growth",
                    "headline": f"{dormant} clients match your reactivation criteria",
                    "detail": (
                        f"No visit in {settings.reactivation_days}+ days and nothing on the calendar."
                    ),
                    "basis": "Counted from last visit date.",
                    "tone": "info",
                }
            )

        calls = overview["calls"]
        if calls["total"]:
            out.append(
                {
                    "kind": "ai",
                    "headline": f"Your AI handled {calls['self_serve_rate']}% of calls end to end",
                    "detail": (
                        f"{calls['total']} calls, {calls['escalated']} passed to your team."
                    ),
                    "basis": "Counted from call outcomes.",
                    "tone": "positive" if calls["self_serve_rate"] >= 80 else "info",
                }
            )

        leads = overview["leads"]
        if leads["total"]:
            out.append(
                {
                    "kind": "conversion",
                    "headline": f"{leads['book_rate']}% of new leads booked",
                    "detail": (
                        f"{leads['booked']} of {leads['total']} leads reached a booking. "
                        f"{leads['hot']} scored hot."
                    ),
                    "basis": "Counted from lead status.",
                    "tone": "positive" if leads["book_rate"] >= 30 else "info",
                }
            )

        reviews = engine["reviews"]
        if reviews["requested"]:
            out.append(
                {
                    "kind": "reputation",
                    "headline": f"{reviews['velocity']}% of review requests turned into reviews",
                    "detail": f"{reviews['received']} received from {reviews['requested']} requests.",
                    "basis": "Counted from retention events.",
                    "tone": "info",
                }
            )

        return out

    # ------------------------------------------------------------------ #
    # Revenue Command Center — the owner's first screen
    # ------------------------------------------------------------------ #
    def command_center(self, days: int = 30, user: str = "staff") -> dict[str, Any]:
        """One request, everything an owner needs in the first ten seconds.

        Composed entirely from the projections that already exist. Nothing is
        recalculated here and nothing new is claimed: this method decides what
        an owner should see first and in what order, and delegates every
        number to the projection that owns it. If :meth:`revenue` changes its
        mind about what counts as recovered, this screen changes with it.

        The headline is deliberately called *influenced* rather than *earned*.
        It is the value of appointments the engine created or brought back,
        priced from whatever evidence exists, and it travels with the basis on
        which it was computed so the interface can caption it truthfully.
        """
        revenue = self.revenue(days=days, user=user)
        overview = self.overview(days=days, user=user)
        opportunities = self.opportunities(limit=80, user=user)
        team = self.agents(days=days, user=user)

        attribution = revenue["attribution"]
        influenced_keys = ("ai_booked", "recovered_no_show", "reactivated")
        influenced_cents = sum(attribution[key]["cents"] for key in influenced_keys)
        influenced_count = sum(attribution[key]["count"] for key in influenced_keys)
        recorded_cents = sum(attribution[key]["recorded_cents"] for key in influenced_keys)
        expected_cents = sum(attribution[key]["expected_cents"] for key in influenced_keys)

        coverage = revenue["coverage"]
        unpriced = coverage["appointments"] - coverage["with_recorded_price"]

        # How the total should be described. An owner is entitled to know
        # whether they are looking at money that has been collected or a
        # forecast built from their own price list.
        if influenced_cents == 0:
            basis = "none"
        elif recorded_cents and expected_cents:
            basis = "mixed"
        elif recorded_cents:
            basis = "recorded"
        else:
            basis = "expected"

        attention = self._attention_queue(opportunities)

        self.audit.log_read(
            None, DataCategory.DASHBOARD, user, details={"view": "command_center"}
        )

        return {
            "window_days": days,
            "clinic": overview["clinic"],
            "headline": {
                "label": "Revenue influenced",
                "cents": influenced_cents,
                "appointments": influenced_count,
                "recorded_cents": recorded_cents,
                "expected_cents": expected_cents,
                "basis": basis,
                "unpriced_appointments": unpriced,
                "trend": overview["trend"]["appointments"],
            },
            "today": self._today_counters(),
            "attention": attention,
            "attention_total": len(
                [item for item in opportunities if item["urgency"] <= 2]
            ),
            "team": [
                {
                    "id": agent["id"],
                    "name": agent["name"],
                    "role": agent["role"],
                    "status": agent["status"],
                    "status_detail": agent["status_detail"],
                    "headline": agent["metrics"][0] if agent["metrics"] else None,
                }
                for agent in team
            ],
            "revenue_split": [
                {
                    "key": key,
                    "label": label,
                    "cents": attribution[key]["cents"],
                    "count": attribution[key]["count"],
                    "complimentary": attribution[key]["complimentary_count"],
                }
                for key, label in (
                    ("ai_booked", "Booked by your AI team"),
                    ("recovered_no_show", "Recovered no-shows"),
                    ("reactivated", "Reactivated clients"),
                    ("front_desk", "Booked by your front desk"),
                )
            ],
            # Asked for generously: the interface collapses consecutive
            # identical events, so a batch of eight reminders becomes one row.
            "activity": self.activity(limit=24, user=user)["items"],
            "generated_at": utcnow().isoformat() + "Z",
        }

    def _today_counters(self) -> list[dict[str, Any]]:
        """What has happened since midnight, clinic time."""
        now = utcnow()
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)

        new_leads = self._count(
            select(func.count(Lead.id)).where(Lead.created_at >= midnight)
        )
        qualified = self._count(
            select(func.count(Lead.id)).where(
                Lead.qualified_at >= midnight,
                Lead.status.in_((LeadStatus.QUALIFIED, LeadStatus.BOOKED)),
            )
        )
        booked = self._count(
            select(func.count(Appointment.id)).where(Appointment.created_at >= midnight)
        )
        recovered = self._count(
            select(func.count(RetentionEvent.id)).where(
                RetentionEvent.created_at >= midnight,
                RetentionEvent.event_type == RetentionEventType.REBOOKED,
            )
        )
        messages = self._count(
            select(func.count(RetentionEvent.id)).where(
                RetentionEvent.created_at >= midnight,
                RetentionEvent.channel == "sms",
            )
        )

        return [
            {"key": "leads", "label": "New enquiries", "value": new_leads},
            {"key": "qualified", "label": "Qualified", "value": qualified},
            {"key": "booked", "label": "Appointments booked", "value": booked},
            {"key": "recovered", "label": "Recovered", "value": recovered},
            {"key": "messages", "label": "Messages sent", "value": messages},
        ]

    def _attention_queue(self, opportunities: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """The handful of things only a human can settle.

        Ordered by urgency, then by how long the person has been waiting.
        Clinical callbacks sort to the top regardless: a patient waiting on a
        provider is never below a warm lead.
        """
        def sort_key(item: dict[str, Any]) -> tuple:
            clinical = 0 if "clinical" in (item.get("flags") or []) else 1
            return (clinical, item["urgency"], -(item.get("waiting_hours") or 0))

        ranked = sorted(opportunities, key=sort_key)
        return ranked[:6]

    # ------------------------------------------------------------------ #
    # Recovery — no-shows, cancellations and dormant clients
    # ------------------------------------------------------------------ #
    def recovery(self, days: int = 90, user: str = "staff") -> dict[str, Any]:
        """What the engine won back, and what it tried and did not.

        Every rate here reports its denominator. "60% recovery rate" is close
        to meaningless on its own — three out of five and six hundred out of a
        thousand are different clinics — so the counts travel with it and the
        interface shows both.

        A wider default window than the rest of the console: recovery is a
        slow loop, and a thirty-day view of a ninety-day process understates
        it.
        """
        since = days_ago(days)

        missed = (
            self.db.execute(
                select(Appointment).where(
                    Appointment.scheduled_for >= since,
                    Appointment.status.in_(
                        (AppointmentStatus.NO_SHOW, AppointmentStatus.CANCELLED)
                    ),
                )
            )
            .scalars()
            .all()
        )

        no_shows = [row for row in missed if row.status == AppointmentStatus.NO_SHOW]
        cancellations = [row for row in missed if row.status == AppointmentStatus.CANCELLED]
        contacted = [row for row in missed if row.reactivation_sent_at is not None]

        stories: list[dict[str, Any]] = []
        recovered_rows: list[Appointment] = []

        for row in contacted:
            follow_up = (
                self.db.execute(
                    select(Appointment)
                    .where(
                        Appointment.patient_id == row.patient_id,
                        Appointment.id != row.id,
                        Appointment.created_at >= row.reactivation_sent_at,
                        Appointment.status.in_(
                            AppointmentStatus.ACTIVE + (AppointmentStatus.COMPLETED,)
                        ),
                    )
                    .order_by(Appointment.created_at)
                )
                .scalars()
                .first()
            )
            if follow_up is not None:
                recovered_rows.append(follow_up)

            stories.append(
                {
                    "id": str(row.id),
                    "subject": self._patient_label(row.patient),
                    "service": _treatment_label(row.service),
                    "missed_status": row.status,
                    "missed_at": _iso(row.scheduled_for),
                    "contacted_at": _iso(row.reactivation_sent_at),
                    "recovered": follow_up is not None,
                    "rebooked_for": _iso(follow_up.scheduled_for) if follow_up else None,
                    "value_cents": follow_up.price_cents if follow_up else None,
                    "record": {"type": "appointment", "id": str(row.id)},
                }
            )

        stories.sort(key=lambda item: (not item["recovered"], item["missed_at"] or ""), reverse=False)

        recovered_value = sum(
            row.price_cents for row in recovered_rows if row.price_cents is not None
        )

        # --- Dormant clients ------------------------------------------- #
        dormant_cutoff = days_ago(settings.reactivation_days)
        dormant = (
            self.db.execute(
                select(Patient).where(
                    Patient.last_visit_at.is_not(None),
                    Patient.last_visit_at < dormant_cutoff,
                )
            )
            .scalars()
            .all()
        )
        dormant_contacted = [
            patient
            for patient in dormant
            if patient.reactivation_sent_at is not None
            and patient.reactivation_sent_at >= since
        ]
        dormant_returned = [
            patient
            for patient in dormant_contacted
            if any(
                appointment.created_at >= patient.reactivation_sent_at
                for appointment in patient.appointments
            )
        ]
        dormant_value = sum(
            appointment.price_cents
            for patient in dormant_returned
            for appointment in patient.appointments
            if appointment.created_at >= patient.reactivation_sent_at
            and appointment.price_cents is not None
        )

        self.audit.log_read(None, DataCategory.DASHBOARD, user, details={"view": "recovery"})

        return {
            "window_days": days,
            "missed": {
                "no_shows": len(no_shows),
                "cancellations": len(cancellations),
                "total": len(missed),
                "contacted": len(contacted),
                "recovered": len(recovered_rows),
                "recovery_rate": _rate(len(recovered_rows), len(contacted)),
                "contact_rate": _rate(len(contacted), len(missed)),
                "value_cents": recovered_value,
                # Stated so the interface never has to render a bare
                # percentage with no denominator behind it.
                "basis": (
                    f"{len(recovered_rows)} of {len(contacted)} contacted"
                    if contacted
                    else "No recovery messages sent in this period"
                ),
            },
            "dormant": {
                "threshold_days": settings.reactivation_days,
                "identified": len(dormant),
                "contacted": len(dormant_contacted),
                "returned": len(dormant_returned),
                "return_rate": _rate(len(dormant_returned), len(dormant_contacted)),
                "value_cents": dormant_value,
                "basis": (
                    f"{len(dormant_returned)} of {len(dormant_contacted)} contacted"
                    if dormant_contacted
                    else "No reactivation messages sent in this period"
                ),
            },
            "stories": stories[:40],
            "generated_at": utcnow().isoformat() + "Z",
        }

    # ------------------------------------------------------------------ #
    # Activity feed
    # ------------------------------------------------------------------ #
    def activity(self, limit: int = 40, user: str = "staff") -> dict[str, Any]:
        """What the engine actually did, most recent first.

        Merged from four tables that each record a different kind of work.
        Nothing is synthesised to fill the feed: a quiet clinic produces a
        short list, and a short list is the honest answer. There is no
        simulated activity anywhere in this method, and there must never be —
        a feed that invents work is the fastest way to destroy an owner's
        trust in every other number on the screen.

        Two constraints shape the implementation:

        *Nothing dated in the future.* A reminder scheduled for next Tuesday
        is not something that happened. Rows are written ahead of time and
        must be filtered out here, or the log reports work nobody has done.

        *Names are resolved last.* Patient relationships are ``lazy="noload"``
        on purpose — a dashboard has no business decrypting a name it will not
        show. So rows carry a patient id through the merge and the handful
        that survive the slice get one batched lookup at the end.
        """
        now = utcnow()
        window = max(limit * 3, 60)
        items: list[dict[str, Any]] = []

        events = (
            self.db.execute(
                select(RetentionEvent)
                .where(RetentionEvent.created_at <= now)
                .order_by(RetentionEvent.created_at.desc())
                .limit(window)
            )
            .scalars()
            .all()
        )
        for event in events:
            items.append(
                {
                    "at": _iso(event.created_at),
                    "actor": _EVENT_ACTORS.get(event.event_type, "Retention"),
                    "text": _EVENT_LABELS.get(
                        event.event_type, event.event_type.replace("_", " ").capitalize()
                    ),
                    "patient_id": event.patient_id,
                    "detail": None,
                    "channel": event.channel,
                    "tone": _EVENT_TONES.get(event.event_type, "neutral"),
                }
            )

        calls = (
            self.db.execute(
                select(VoiceCall)
                .where(VoiceCall.created_at <= now)
                .order_by(VoiceCall.created_at.desc())
                .limit(window)
            )
            .scalars()
            .all()
        )
        for call in calls:
            items.append(
                {
                    "at": _iso(call.created_at),
                    "actor": "AI Receptionist",
                    "text": f"Call {_outcome_label(call.outcome).lower()}",
                    "patient_id": call.patient_id,
                    "detail": None,
                    "channel": "voice",
                    "tone": "urgent"
                    if call.outcome
                    in (VoiceCallOutcome.CALLBACK_REQUESTED, VoiceCallOutcome.TRANSFERRED)
                    else "neutral",
                }
            )

        leads = (
            self.db.execute(
                select(Lead)
                .where(Lead.qualified_at.is_not(None), Lead.qualified_at <= now)
                .order_by(Lead.qualified_at.desc())
                .limit(window)
            )
            .scalars()
            .all()
        )
        for lead in leads:
            items.append(
                {
                    "at": _iso(lead.qualified_at),
                    "actor": "Lead Concierge",
                    "text": f"Qualified a {_treatment_label(lead.treatment_interest).lower()} enquiry",
                    "patient_id": None,
                    "detail": f"{mask_name(lead.name) or 'Anonymous'} · {lead.qualification_score}/100",
                    "channel": lead.source,
                    "tone": "good" if lead.temperature == LeadTemperature.HOT else "neutral",
                }
            )

        appointments = (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.created_at <= now,
                    Appointment.source.in_(
                        (AppointmentSource.VOICE, AppointmentSource.WEB, AppointmentSource.SMS)
                    ),
                )
                .order_by(Appointment.created_at.desc())
                .limit(window)
            )
            .scalars()
            .all()
        )
        for appointment in appointments:
            items.append(
                {
                    "at": _iso(appointment.created_at),
                    "actor": "Booking",
                    "text": f"Booked {_treatment_label(appointment.service).lower()}",
                    "patient_id": appointment.patient_id,
                    "detail": None,
                    "channel": appointment.source,
                    "tone": "good",
                }
            )

        items = [item for item in items if item["at"]]
        items.sort(key=lambda item: item["at"], reverse=True)
        items = items[:limit]

        # One batched lookup for the names actually being shown.
        wanted = {item["patient_id"] for item in items if item["patient_id"] and not item["detail"]}
        if wanted:
            patients = (
                self.db.execute(select(Patient).where(Patient.id.in_(wanted))).scalars().all()
            )
            labels = {patient.id: self._patient_label(patient) for patient in patients}
            for item in items:
                if item["detail"] is None:
                    item["detail"] = labels.get(item["patient_id"])

        for item in items:
            item.pop("patient_id", None)

        self.audit.log_read(None, DataCategory.DASHBOARD, user, details={"view": "activity"})
        return {"items": items, "generated_at": utcnow().isoformat() + "Z"}

    # ------------------------------------------------------------------ #
    # System status
    # ------------------------------------------------------------------ #
    def system(self, user: str = "staff") -> dict[str, Any]:
        """What is genuinely connected. Nothing here is aspirational."""
        self.audit.log_read(None, DataCategory.DASHBOARD, user, details={"view": "system"})

        integrations = [
            {
                "id": "phone",
                "name": "Phone system",
                "provider": "VAPI",
                "purpose": "Lets the AI Receptionist answer your phone.",
                "connected": bool(settings.vapi_webhook_secret),
                "detail": (
                    "Receiving calls"
                    if settings.vapi_webhook_secret
                    else "Set VAPI_WEBHOOK_SECRET and point the assistant at /webhooks/vapi"
                ),
            },
            {
                "id": "sms",
                "name": "Text messaging",
                "provider": "Twilio",
                "purpose": "Delivers reminders, recovery offers and review requests.",
                "connected": settings.twilio_enabled,
                "detail": (
                    "Messages are delivered"
                    if settings.twilio_enabled
                    else "Messages are composed and audited but never leave the system"
                ),
            },
            {
                "id": "ai",
                "name": "AI model",
                "provider": _PROVIDER_LABELS.get(settings.llm_provider, settings.llm_provider),
                "purpose": "Writes the language your agents use.",
                "connected": settings.llm_enabled,
                "detail": (
                    f"Using {settings.llm_model_fast} / {settings.llm_model_smart}"
                    if settings.llm_enabled
                    else "Running on the built-in rule engine — qualification and routing are unaffected"
                ),
            },
            {
                "id": "calendar",
                "name": "Online scheduling",
                "provider": "Calendly",
                "purpose": "Sends hot leads a booking link they can use themselves.",
                "connected": settings.calendly_enabled,
                "detail": (
                    "Booking links are issued per lead"
                    if settings.calendly_enabled
                    else "Not connected — this system books into its own calendar instead"
                ),
            },
            _booking_integration(),
        ]

        return {
            "clinic": {
                "name": settings.clinic_name,
                "timezone": settings.clinic_timezone,
                "hours": f"{settings.clinic_open_hour}:00–{settings.clinic_close_hour}:00",
                "booking_url": settings.clinic_booking_url,
                "review_url": settings.clinic_review_url,
            },
            "environment": settings.environment,
            "is_production": settings.is_production,
            # Demo state rides on the one request the console always makes, so
            # a demonstration console can badge itself before it paints a page.
            "demo": demo_service.demo_state(self.db),
            "integrations": integrations,
            "retention": {
                "reactivation_days": settings.reactivation_days,
                "review_request_delay_days": settings.review_request_delay_days,
                "no_show_credit_amount": settings.no_show_credit_amount,
                "sms_include_treatment_details": settings.sms_include_treatment_details,
            },
            "advanced": {
                "app_version_source": "app/__init__.py",
                "database": "PostgreSQL" if not settings.is_sqlite else "SQLite",
                "encryption_configured": bool(settings.encryption_key),
                "llm_provider": settings.llm_provider,
                "zero_data_retention": settings.llm_zero_retention,
                "booking_system_type": settings.booking_system_type,
                "slot_minutes": settings.appointment_slot_minutes,
            },
            "warnings": settings.startup_warnings(),
        }

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _count(self, statement) -> int:
        return int(self.db.scalar(statement) or 0)

    def _patient_label(self, patient: Optional[Patient]) -> str:
        if patient is None:
            return "Unknown caller"
        return mask_name(patient.name) or "Client"

    def _lead_row(self, lead: Lead) -> dict[str, Any]:
        return {
            "lead_id": str(lead.id),
            "display_name": mask_name(lead.name) or "Anonymous",
            "masked_phone": mask_phone(lead.phone),
            "source": lead.source,
            "source_label": _source_label(lead.source),
            "status": lead.status,
            "temperature": lead.temperature,
            "score": lead.qualification_score,
            "treatment_interest": lead.treatment_interest,
            "treatment_label": _treatment_label(lead.treatment_interest),
            "budget_range": lead.budget_range,
            "timeline": lead.timeline,
            "needs_provider_approval": lead.needs_provider_approval,
            "medical_callback_required": lead.medical_callback_required,
            "answered_questions": lead.answered_questions,
            "next_action": _lead_next_action(lead),
            "created_at": _iso(lead.created_at),
            "updated_at": _iso(lead.updated_at),
            "qualified_at": _iso(lead.qualified_at),
        }

    def _lead_journey(self, lead: Lead) -> list[dict[str, Any]]:
        """The stages this lead actually reached, with the rest marked pending."""
        booked_appointment = None
        if lead.phone_fingerprint:
            patient = self.db.execute(
                select(Patient).where(Patient.phone_fingerprint == lead.phone_fingerprint)
            ).scalar_one_or_none()
            if patient is not None:
                booked_appointment = self.db.execute(
                    select(Appointment)
                    .where(Appointment.patient_id == patient.id)
                    .order_by(Appointment.scheduled_for.desc())
                    .limit(1)
                ).scalar_one_or_none()

        stages = [
            {"label": "Enquiry received", "at": _iso(lead.created_at), "done": True},
            {
                "label": "AI responded",
                "at": _iso(lead.created_at),
                "done": bool((lead.conversation_state or {}).get("turns")),
            },
            {
                "label": "Questions answered",
                "at": None,
                "done": lead.answered_questions >= 6,
                "note": f"{lead.answered_questions} of 6",
            },
            {
                "label": "Qualified",
                "at": _iso(lead.qualified_at),
                "done": lead.status in (LeadStatus.QUALIFIED, LeadStatus.BOOKED),
            },
            {
                "label": "Appointment booked",
                "at": _iso(booked_appointment.scheduled_for) if booked_appointment else None,
                "done": lead.status == LeadStatus.BOOKED or booked_appointment is not None,
            },
            {
                "label": "Treatment completed",
                "at": _iso(booked_appointment.completed_at) if booked_appointment else None,
                "done": bool(
                    booked_appointment
                    and booked_appointment.status == AppointmentStatus.COMPLETED
                ),
            },
        ]
        return stages


# --------------------------------------------------------------------- #
# Module-level helpers
# --------------------------------------------------------------------- #
def _accumulate(bucket: dict[str, int], appointment: Appointment) -> None:
    """Add one appointment to a bucket, keeping the two price claims apart.

    ``recorded_cents`` is money a booking platform or a member of staff told
    us about. ``expected_cents`` is the clinic's own list value, applied
    because nothing better existed. Both roll up into ``cents`` for callers
    that want the combined figure, but the split travels with it so the
    console can label a total as projected instead of collected.
    """
    bucket["count"] += 1
    if appointment.price_cents is None:
        return

    bucket["priced_count"] += 1
    bucket["cents"] += appointment.price_cents
    if appointment.price_cents == 0:
        # A complimentary consultation is a real, known price. Counting it
        # among the priced rows but not the revenue keeps the average ticket
        # honest — twenty free consults must not read as a $0 treatment.
        bucket["complimentary_count"] += 1
    if pricing_service.price_source(appointment) == pricing_service.PRICE_SOURCE_EXPECTED:
        bucket["expected_cents"] += appointment.price_cents
    else:
        bucket["recorded_cents"] += appointment.price_cents


def _rate(part: int, whole: int) -> float:
    return round((part / whole) * 100, 1) if whole else 0.0


def _iso(value) -> Optional[str]:
    return value.isoformat() + "Z" if value is not None else None


def _hours_between(value, now) -> float:
    if value is None:
        return 0.0
    return round(abs((now - value).total_seconds()) / 3600, 1)


def _decorate(item: dict[str, Any]) -> dict[str, Any]:
    meta = OPPORTUNITY_KINDS[item["kind"]]
    return {**item, "kind_label": meta["label"], "tone": meta["tone"], "why": meta["why"]}


def _lead_flags(lead: Lead) -> list[str]:
    flags = []
    if lead.needs_provider_approval:
        flags.append("Provider approval required")
    if lead.medical_callback_required:
        flags.append("Medical callback required")
    return flags


def _lead_next_action(lead: Lead) -> str:
    """The action the engine already decided on, in owner language."""
    # Keys are the exact values LeadService writes to ``Lead.next_action``.
    mapping = {
        "auto_book_consultation": "Consultation offered — confirm the booking",
        "staff_followup_24h": "Follow up within 24 hours",
        "educational_nurture": "Educational follow-up scheduled",
        "medical_callback": "Provider callback required",
    }
    # A flag outranks the stage: a booked lead who needs a clinician's sign-off
    # is not "no action needed", whatever its status column says.
    if lead.medical_callback_required:
        return "Provider callback required before treatment"
    if lead.needs_provider_approval:
        return "Provider approval required before treatment"
    if lead.next_action and lead.next_action in mapping:
        return mapping[lead.next_action]
    if lead.status == LeadStatus.BOOKED:
        return "Booked — no action needed"
    if lead.status == LeadStatus.DISQUALIFIED:
        return "Not eligible — provider callback booked"
    if lead.answered_questions < 6:
        return "Qualification unfinished — reach out directly"
    return "Follow up"


#: Human labels for the qualification slot the engine is waiting on. Keyed by
#: the ``asking`` value ``LeadService`` writes into ``conversation_state``.
_QUESTION_LABELS = {
    "treatment_interest": "Asked which treatment they want",
    "previous_experience": "Asked whether they have had it before",
    "is_pregnant": "Asked the pregnancy safety question",
    "blood_thinner": "Asked about blood thinners",
    "budget_range": "Asked about budget",
    "timeline": "Asked about timing",
    "phone": "Asked for a phone number",
}


def _question_label(asking: Optional[str]) -> Optional[str]:
    if not asking:
        return None
    return _QUESTION_LABELS.get(asking, f"Waiting on {asking.replace('_', ' ')}")


#: Vendor names as an owner would recognise them.
_PROVIDER_LABELS = {"openai": "OpenAI", "gemini": "Google Gemini", "none": "Rule engine"}


_TREATMENTS = {
    "botox": "Botox",
    "fillers": "Dermal fillers",
    "laser": "Laser treatment",
    "facial": "Facial",
    "peel": "Chemical peel",
    "microneedling": "Microneedling",
    "coolsculpting": "CoolSculpting",
    "consultation": "Consultation",
}


def _treatment_label(value: Optional[str]) -> str:
    if not value:
        return "Not specified"
    return _TREATMENTS.get(value, value.replace("_", " ").title())


_SOURCES = {
    "voice": "the phone agent",
    "web": "the website",
    "sms": "text message",
    "staff": "your team",
    "booking_system": "your practice calendar",
    "website_chat": "Website chat",
    "phone": "Phone",
    "referral": "Referral",
}


def _source_label(value: Optional[str]) -> str:
    if not value:
        return "Unknown"
    return _SOURCES.get(value, value.replace("_", " ").title())


_OUTCOMES = {
    "booked": "Appointment booked",
    "rescheduled": "Appointment moved",
    "cancelled": "Appointment cancelled",
    "faq": "Question answered",
    "transferred": "Transferred to your team",
    "callback_requested": "Provider callback requested",
    "voicemail": "Voicemail",
    "abandoned": "Caller hung up",
    "in_progress": "Call in progress",
}


def _outcome_label(value: Optional[str]) -> str:
    if not value:
        return "Call"
    return _OUTCOMES.get(value, value.replace("_", " ").capitalize())


def _booking_integration() -> dict[str, Any]:
    """Whether the practice calendar is genuinely wired up.

    Each backend proves it differently — the vendor adapters need an API key,
    Google needs three OAuth values — so "connected" is answered per provider
    rather than by looking for a key that Google never uses. Two out of three
    OAuth values is not connected, and the detail line says which is missing
    without printing any of them.
    """
    kind = (settings.booking_system_type or "generic").lower()

    if kind in ("google", "google_calendar"):
        connected = settings.google_calendar_enabled
        missing = [
            name
            for name, value in (
                ("client ID", settings.google_oauth_client_id),
                ("client secret", settings.google_oauth_client_secret),
                ("refresh token", settings.google_oauth_refresh_token),
            )
            if not value
        ]
        return {
            "id": "booking",
            "name": "Practice calendar",
            "provider": "Google Calendar",
            "connected": connected,
            "purpose": "Books appointments straight into the clinic's calendar.",
            "detail": (
                f"Writing to {settings.google_calendar_id or 'primary'}"
                if connected
                else "Not connected — still missing the " + ", ".join(missing)
            ),
        }

    if kind in ("generic", "internal"):
        return {
            "id": "booking",
            "name": "Practice calendar",
            "provider": "Built-in scheduler",
            "connected": False,
            "purpose": "Keeps appointments in step with your practice software.",
            "detail": "Using the built-in calendar — no external system connected",
        }

    connected = bool(settings.booking_api_key)
    return {
        "id": "booking",
        "name": "Practice calendar",
        "provider": settings.booking_system_type,
        "connected": connected,
        "purpose": "Keeps appointments in step with your practice software.",
        "detail": (
            f"Connected to {settings.booking_system_type}"
            if connected
            else f"{settings.booking_system_type} selected but no API key is set"
        ),
    }


def _event_row(event: RetentionEvent) -> dict[str, Any]:
    return {
        "event_type": event.event_type,
        "label": _EVENT_LABELS.get(event.event_type, event.event_type.replace("_", " ").capitalize()),
        "channel": event.channel,
        "metadata": event.event_metadata,
        "created_at": _iso(event.created_at),
    }


#: Which member of the AI team a retention event belongs to. The feed reads as
#: a team log rather than a table dump because of this mapping — but the
#: events themselves are real rows, and an unmapped type falls back to a
#: generic actor rather than being dropped or invented.
_EVENT_ACTORS = {
    "reminder_sent": "Booking",
    "final_reminder_sent": "Booking",
    "no_show": "Recovery",
    "reactivation_sent": "Recovery",
    "credit_offer_sent": "Recovery",
    "rebooked": "Recovery",
    "review_requested": "Reviews",
    "review_received": "Reviews",
    "review_response_drafted": "Reviews",
    "treatment_completed": "Booking",
    "nurture_sent": "Lead Concierge",
}

_EVENT_TONES = {
    "no_show": "urgent",
    "rebooked": "good",
    "review_received": "good",
    "credit_offer_sent": "warn",
    "reactivation_sent": "warn",
}

_EVENT_LABELS = {
    "reminder_sent": "Reminder sent",
    "final_reminder_sent": "Final reminder sent",
    "no_show": "Marked as no-show",
    "reactivation_sent": "Recovery message sent",
    "credit_offer_sent": "Rebooking credit offered",
    "review_requested": "Review requested",
    "review_received": "Review received",
    "review_response_drafted": "Reply drafted",
    "treatment_completed": "Treatment completed",
    "rebooked": "Rebooked",
    "nurture_sent": "Follow-up message sent",
}


#: Business-facing descriptions of the five orchestration workflows. The step
#: lists mirror the node graphs in ``n8n-workflows/*.json``; the trigger and
#: name are read from the file itself so this cannot drift silently.
_WORKFLOW_META = {
    "no_show_prevention": {
        "title": "Appointment reminders & no-show recovery",
        "summary": "Reminds clients before their visit and chases the ones who miss it.",
        "steps": [
            "Appointment booked",
            "24-hour reminder",
            "2-hour reminder",
            "Visit missed?",
            "Same-day recovery message",
            "Rebooking credit after 3 days",
        ],
    },
    "review_request": {
        "title": "Review requests",
        "summary": "Asks for a review after a treatment and drafts your reply.",
        "steps": [
            "Treatment completed",
            f"Wait {settings.review_request_delay_days} days",
            "Review request sent",
            "Review received",
            "Reply drafted for approval",
        ],
    },
    "reactivation_sequence": {
        "title": "Dormant client reactivation",
        "summary": "Finds clients who stopped coming in and invites them back.",
        "steps": [
            "Daily scan for dormant clients",
            "Marketing consent check",
            "Reactivation offer",
            "Rebooking tracked",
        ],
    },
    "lead_qualification": {
        "title": "New lead → booking",
        "summary": "Qualifies every new enquiry and routes it by intent.",
        "steps": [
            "New enquiry",
            "Lead Concierge qualifies",
            "Scored hot / warm / cold",
            "Hot → consultation offered",
            "Warm → staff follow-up",
            "Cold → educational follow-up",
        ],
    },
    "voice_handoff": {
        "title": "Clinical callback promise",
        "summary": "Tracks the 2-hour callback the phone agent promises.",
        "steps": [
            "Clinical question on a call",
            "Callback logged",
            "Team notified",
            "Escalated if still open after 2 hours",
        ],
    },
}


def _workflow_dir() -> Path:
    """Where the n8n workflow definitions live, if they shipped with the image."""
    return Path(__file__).resolve().parents[3] / "n8n-workflows"


def _load_workflow_definitions() -> list[dict[str, Any]]:
    """Read the real workflow JSON where it is available, fall back to metadata.

    The Docker image is built from ``backend/`` alone, so the workflow files
    are usually not on disk in a deployed container. The console still
    describes the five workflows — it just reports ``definition_available:
    false`` rather than pretending it read a file it could not open.
    """
    directory = _workflow_dir()
    out: list[dict[str, Any]] = []
    for key, meta in _WORKFLOW_META.items():
        path = directory / f"{key}.json"
        node_count: Optional[int] = None
        available = False
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                node_count = len(data.get("nodes", []))
                available = True
            except (OSError, ValueError):  # pragma: no cover - defensive
                logger.warning("Could not read workflow definition %s", path)
        out.append(
            {
                "key": key,
                "title": meta["title"],
                "summary": meta["summary"],
                "steps": meta["steps"],
                "node_count": node_count,
                "definition_available": available,
            }
        )
    return out


__all__ = ["ConsoleService", "OPPORTUNITY_KINDS"]
