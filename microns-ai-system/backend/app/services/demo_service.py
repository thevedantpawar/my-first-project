"""The Glow Aesthetics demonstration clinic.

A salesperson needs to show a med spa owner the whole revenue loop — enquiry,
qualification, booking, no-show, recovery, reactivation, revenue — in about
ten minutes. A console wired to an empty database shows none of it, and a
console wired to hand-written numbers is a lie that collapses the moment
anyone clicks through to the underlying record.

So this module seeds a clinic instead of seeding a dashboard.

Three rules hold it together:

**Everything is derived, nothing is asserted.** No headline figure is written
anywhere. If the Revenue Command Center says six appointments were recovered,
that is because six appointment rows exist whose patients had an earlier
no-show and a recovery message before they rebooked. Click any number and the
records are there.

**The real engine does the work.** Leads are scored by
:class:`LeadService`, not by a lookup table of pre-baked scores, and hot leads
auto-book through the real booking path. The demo therefore demonstrates the
product rather than a description of it — and if the scoring changes, the demo
changes with it.

**Nothing here can be mistaken for a patient.** Every row is tagged
``demo: True`` in its metadata, every name is drawn from a fixed fictional
cast, and every phone number sits in the +1 555 01xx range reserved for
fiction. Seeding is refused outright in production.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.audit_log import AuditLog
from app.models.lead import Lead, LeadSource, LeadStatus
from app.models.patient import Patient
from app.models.retention_event import RetentionEvent, RetentionEventType
from app.models.voice_call import VoiceCall, VoiceCallOutcome
from app.services import pricing_service
from app.utils import utcnow

logger = logging.getLogger(__name__)

DEMO_CLINIC_NAME = "Glow Aesthetics"

#: Marks every row this module writes. Read back by :func:`is_demo_row` and by
#: the console, which badges demo data everywhere it appears.
DEMO_FLAG = "demo"

#: A fixed seed, so the same command produces the same clinic every time. A
#: demo that reshuffles between rehearsal and the actual call is a demo that
#: will surprise you in front of a prospect.
SEED = 20240917

#: Reserved-for-fiction numbering. 555-0100 through 555-0199 is set aside for
#: fiction in every North American area code, so none of these can route to a
#: real person. Patients and leads use different area codes purely to keep the
#: two ranges from colliding.
_PATIENT_AREA_CODE = "212"
_LEAD_AREA_CODE = "332"


def _fiction_number(area_code: str, sequence: int) -> str:
    """A number in the 555-01xx block. ``sequence`` must be 0-99."""
    if not 0 <= sequence <= 99:
        raise ValueError("the reserved fiction block only holds 100 numbers")
    return f"+1{area_code}555{100 + sequence:04d}"

FIRST_NAMES = [
    "Amelia", "Priya", "Sofia", "Jordan", "Chloe", "Maya", "Elena", "Grace",
    "Nina", "Rachel", "Talia", "Bianca", "Harper", "Camila", "Iris", "Leah",
    "Naomi", "Dana", "Rosa", "Yuki", "Farah", "Alexis", "Simone", "Paige",
    "Marisol", "Devon", "Anika", "Claudia", "Renee", "Tessa", "Blair", "Noor",
]
LAST_NAMES = [
    "Whitfield", "Okafor", "Marchetti", "Delgado", "Bennett", "Nakamura",
    "Ferreira", "Lindqvist", "Ashford", "Kowalski", "Rahman", "Beaumont",
    "Castellanos", "Ellery", "Vance", "Sandoval",
]

SERVICES = ["botox", "fillers", "laser", "facial", "peel"]
PROVIDERS = ["Dr. Reyes", "Dr. Aluko", "Nurse Practitioner Hale"]


# --------------------------------------------------------------------- #
# Guards
# --------------------------------------------------------------------- #
class DemoModeRefused(RuntimeError):
    """Raised when demo data is requested somewhere it must never exist."""


def assert_seedable() -> None:
    """Demo data and production are mutually exclusive, with no override.

    There is no force flag on purpose. A fictional patient in a live clinic
    database is a data-integrity incident that outlives whoever typed the
    command, and no demo is worth that.
    """
    if settings.is_production:
        raise DemoModeRefused(
            "Refusing to seed demo data in a production environment. "
            "Demo mode exists to sell the product, not to populate a clinic."
        )


def is_demo_row(row: Any) -> bool:
    """True when a record was written by this module."""
    for attribute in ("extra", "event_metadata", "conversation_state", "summary"):
        payload = getattr(row, attribute, None)
        if isinstance(payload, dict) and payload.get(DEMO_FLAG) is True:
            return True
    return False


# --------------------------------------------------------------------- #
# State
# --------------------------------------------------------------------- #
def demo_state(db: Session) -> dict[str, Any]:
    """What the console needs to badge itself honestly.

    ``active`` means this deployment is configured as a demonstration.
    ``seeded`` means the Glow Aesthetics records are actually present. They
    are independent: a console can be in demo mode with nothing seeded yet,
    and that should read as an empty demo rather than as a quiet clinic.
    """
    seeded = db.execute(
        select(func.count(Patient.id)).where(Patient.external_id.like("demo-%"))
    ).scalar_one()

    return {
        "active": bool(settings.demo_mode),
        "seeded": seeded > 0,
        "clinic": DEMO_CLINIC_NAME,
        "patients": int(seeded),
        "note": (
            "Every record in this console is fictional demonstration data for "
            f"{DEMO_CLINIC_NAME}. No real patient information is present."
        ),
    }


# --------------------------------------------------------------------- #
# Teardown
# --------------------------------------------------------------------- #
def clear(db: Session) -> dict[str, int]:
    """Remove seeded records. Only ever touches rows tagged as demo.

    Deletes are issued in foreign-key order as bulk statements rather than
    through the ORM: letting SQLAlchemy cascade from ``Patient`` would race
    the explicit child deletes, and ``VoiceCall.patient_id`` is ``SET NULL``
    anyway, which would leave orphaned demo calls behind rather than removing
    them.
    """
    assert_seedable()

    patient_ids = list(
        db.execute(
            select(Patient.id).where(Patient.external_id.like("demo-%"))
        ).scalars()
    )
    lead_ids = list(
        db.execute(select(Lead.id).where(Lead.session_id.like("demo-%"))).scalars()
    )

    removed = {"patients": 0, "appointments": 0, "leads": 0, "voice_calls": 0, "events": 0}

    def run(statement) -> int:
        return db.execute(statement).rowcount or 0

    if patient_ids or lead_ids:
        conditions = []
        if patient_ids:
            conditions.append(RetentionEvent.patient_id.in_(patient_ids))
        if lead_ids:
            conditions.append(RetentionEvent.lead_id.in_(lead_ids))
        removed["events"] = run(delete(RetentionEvent).where(or_(*conditions)))

    if patient_ids:
        removed["voice_calls"] = run(
            delete(VoiceCall).where(VoiceCall.patient_id.in_(patient_ids))
        )
        removed["appointments"] = run(
            delete(Appointment).where(Appointment.patient_id.in_(patient_ids))
        )

    if lead_ids:
        removed["leads"] = run(delete(Lead).where(Lead.id.in_(lead_ids)))

    if patient_ids:
        removed["patients"] = run(delete(Patient).where(Patient.id.in_(patient_ids)))

    # Instances loaded before the bulk deletes are now stale.
    db.expire_all()
    db.commit()
    logger.info("Cleared demo data: %s", removed)
    return removed


# --------------------------------------------------------------------- #
# Seed
# --------------------------------------------------------------------- #
def seed(db: Session, *, replace: bool = True) -> dict[str, Any]:
    """Build the Glow Aesthetics clinic. Returns counts of what was written."""
    assert_seedable()

    if replace:
        clear(db)

    rng = random.Random(SEED)
    now = utcnow()

    # Everything that existed before this run is off limits. The engine
    # creates patients of its own while auto-booking, and they must be tagged
    # as demo — but "untagged patient" is emphatically not the same thing as
    # "one we just made", and treating it as such would put a real clinic
    # record on the teardown list.
    pre_existing_patient_ids = set(db.execute(select(Patient.id)).scalars())

    counts = {
        "patients": 0,
        "appointments": 0,
        "leads": 0,
        "voice_calls": 0,
        "retention_events": 0,
    }

    people = _make_people(rng)
    patients: list[Patient] = []

    for index, (first, last) in enumerate(people):
        patient = Patient.create(
            phone=_fiction_number(_PATIENT_AREA_CODE, index),
            name=f"{first} {last}",
            sms_consent=True,
            marketing_consent=rng.random() > 0.2,
        )
        patient.external_id = f"demo-{index:03d}"
        patient.preferred_provider = rng.choice(PROVIDERS)
        db.add(patient)
        patients.append(patient)
        counts["patients"] += 1

    db.flush()

    # --- Cohorts ------------------------------------------------------ #
    # Sliced rather than sampled so the shape of the demo is fixed and the
    # numbers a salesperson quotes on Monday still hold on Thursday.
    dormant = patients[0:20]
    no_show_cohort = patients[20:32]
    regulars = patients[32:]

    counts["appointments"] += _seed_regular_history(db, rng, regulars, now)
    counts["appointments"] += _seed_upcoming(db, rng, regulars, now)

    recovered, events = _seed_no_show_and_recovery(db, rng, no_show_cohort, now)
    counts["appointments"] += recovered
    counts["retention_events"] += events

    reactivated, events = _seed_dormant_and_reactivation(db, rng, dormant, now)
    counts["appointments"] += reactivated
    counts["retention_events"] += events

    cancelled, events = _seed_cancellations(db, rng, regulars, now)
    counts["appointments"] += cancelled
    counts["retention_events"] += events

    counts["retention_events"] += _seed_reminders_and_reviews(db, rng, regulars, now)
    counts["voice_calls"] += _seed_voice_calls(db, rng, patients, now)
    counts["voice_calls"] += _seed_today(db, rng, regulars, now)

    db.commit()

    known_patient_ids = pre_existing_patient_ids | {patient.id for patient in patients}
    counts["leads"] = _seed_leads(db, rng, now)

    # Qualifying a hot lead auto-books a consultation, and booking creates a
    # patient through the ordinary path — which knows nothing about demo mode.
    # Those patients are demo data too: tag them, or `clear` walks past them
    # and the next seed stacks a second clinic on top of the first.
    counts["patients"] += _tag_patients_created_by_the_engine(db, known_patient_ids)

    db.commit()
    logger.info("Seeded %s: %s", DEMO_CLINIC_NAME, counts)
    return {"clinic": DEMO_CLINIC_NAME, **counts}


def _tag_patients_created_by_the_engine(db: Session, known: set) -> int:
    """Mark patients the engine created during seeding as demo records.

    ``known`` holds every patient id that existed before seeding started plus
    the ones this module created directly. Anything outside it appeared during
    the run, which means the booking path made it, which makes it demo data.
    Identity is established by "did not exist when we started" — never by a
    missing tag, which a real clinic record would also lack.
    """
    candidates = (
        db.execute(select(Patient).where(Patient.external_id.is_(None))).scalars().all()
    )
    tagged = 0
    for patient in candidates:
        if patient.id in known:
            continue
        patient.external_id = f"demo-auto-{tagged:03d}"
        tagged += 1
    db.flush()
    return tagged


def _make_people(rng: random.Random) -> list[tuple[str, str]]:
    people = []
    # Sized to look like the clinic being sold to: a mid-size med spa with a
    # real book, not a pilot with a dozen patients. The cast repeats with
    # different surnames, which is what keeps the names obviously fictional.
    for index in range(88):
        first = FIRST_NAMES[index % len(FIRST_NAMES)]
        last = LAST_NAMES[(index * 7 + 3) % len(LAST_NAMES)]
        people.append((first, last))
    return people


def _appointment(
    db: Session,
    patient: Patient,
    *,
    service: str,
    when: datetime,
    status: str,
    source: str,
    created_at: Optional[datetime] = None,
    provider: Optional[str] = None,
    extra: Optional[dict] = None,
) -> Appointment:
    """Create one demo appointment, priced the way a real one would be."""
    appointment = Appointment(
        patient_id=patient.id,
        service=service,
        provider=provider,
        scheduled_for=when,
        duration_minutes=settings.appointment_slot_minutes,
        status=status,
        source=source,
        extra={DEMO_FLAG: True, **(extra or {})},
    )
    if status == AppointmentStatus.COMPLETED:
        appointment.completed_at = when
    if status == AppointmentStatus.CANCELLED:
        appointment.cancelled_at = when - timedelta(hours=6)

    # Demo appointments carry the clinic's list value, tagged as expected —
    # the same path a live clinic takes before a booking platform is wired up.
    pricing_service.apply_expected_price(appointment)

    db.add(appointment)
    db.flush()
    # created_at defaults to now(); the demo needs history, so it is set
    # explicitly after the insert.
    appointment.created_at = created_at or (when - timedelta(days=2))
    return appointment


def _event(
    db: Session,
    *,
    event_type: str,
    patient: Optional[Patient] = None,
    appointment: Optional[Appointment] = None,
    channel: str = "sms",
    created_at: Optional[datetime] = None,
    metadata: Optional[dict] = None,
) -> RetentionEvent:
    event = RetentionEvent(
        patient_id=patient.id if patient else None,
        appointment_id=appointment.id if appointment else None,
        event_type=event_type,
        channel=channel,
        event_metadata={DEMO_FLAG: True, **(metadata or {})},
    )
    db.add(event)
    db.flush()
    if created_at:
        event.created_at = created_at
    return event


def _seed_regular_history(db, rng, patients, now) -> int:
    """Completed visits over the last six weeks — the clinic's baseline."""
    created = 0
    for patient in patients:
        for _ in range(rng.randint(1, 3)):
            days_ago = rng.randint(3, 88)
            when = now - timedelta(days=days_ago, hours=rng.randint(0, 8))
            source = rng.choice(
                [AppointmentSource.STAFF, AppointmentSource.STAFF, AppointmentSource.VOICE, AppointmentSource.WEB]
            )
            _appointment(
                db,
                patient,
                service=rng.choice(SERVICES),
                when=when,
                status=AppointmentStatus.COMPLETED,
                source=source,
                provider=patient.preferred_provider,
            )
            patient.last_visit_at = when
            created += 1
    return created


def _seed_upcoming(db, rng, patients, now) -> int:
    """The book for the next fortnight."""
    created = 0
    for patient in patients[: len(patients) - 4]:
        if rng.random() > 0.55:
            continue
        when = now + timedelta(days=rng.randint(1, 14), hours=rng.randint(0, 7))
        _appointment(
            db,
            patient,
            service=rng.choice(SERVICES),
            when=when,
            status=AppointmentStatus.CONFIRMED,
            source=rng.choice([AppointmentSource.VOICE, AppointmentSource.WEB, AppointmentSource.STAFF]),
            created_at=now - timedelta(days=rng.randint(1, 9)),
            provider=patient.preferred_provider,
        )
        created += 1
    return created


def _seed_no_show_and_recovery(db, rng, patients, now) -> tuple[int, int]:
    """No-shows, the recovery message, and the rebooking that followed.

    This is the sequence that makes ``_attribution`` return
    ``recovered_no_show``: a prior no-show carrying ``reactivation_sent_at``,
    followed by an agent-sourced appointment created afterwards. The
    attribution is not asserted anywhere — it falls out of these rows.
    """
    appointments = 0
    events = 0

    for index, patient in enumerate(patients):
        missed_when = now - timedelta(days=rng.randint(12, 52))
        missed = _appointment(
            db,
            patient,
            service=rng.choice(SERVICES),
            when=missed_when,
            status=AppointmentStatus.NO_SHOW,
            source=AppointmentSource.STAFF,
            provider=patient.preferred_provider,
        )
        appointments += 1
        _event(
            db,
            event_type=RetentionEventType.NO_SHOW,
            patient=patient,
            appointment=missed,
            channel="system",
            created_at=missed_when + timedelta(hours=1),
        )
        events += 1

        # Roughly a third are never contacted and a third of those contacted
        # never come back. Expressed as fractions of the cohort so the rates
        # hold whatever size the demo clinic is set to — a demo where every
        # recovery succeeds is not a demo anyone believes.
        contacted_cutoff = int(len(patients) * 0.67)
        rebooked_cutoff = int(len(patients) * 0.42)

        if index >= contacted_cutoff:
            continue

        # Two steps, in the order RetentionService actually sends them: a
        # recovery message within hours, then a rebooking credit a few days
        # later if nothing has happened.
        offer_at = missed_when + timedelta(hours=2)
        missed.reactivation_sent_at = offer_at
        _event(
            db,
            event_type=RetentionEventType.REACTIVATION_SENT,
            patient=patient,
            appointment=missed,
            created_at=offer_at,
        )
        events += 1

        credit_at = offer_at + timedelta(days=3)
        missed.credit_offer_sent_at = credit_at
        _event(
            db,
            event_type=RetentionEventType.CREDIT_OFFER_SENT,
            patient=patient,
            appointment=missed,
            created_at=credit_at,
            metadata={"credit_amount": settings.no_show_credit_amount},
        )
        events += 1

        if index >= rebooked_cutoff:
            continue

        rebooked_created = offer_at + timedelta(days=1)
        rebooked_when = missed_when + timedelta(days=rng.randint(6, 11))
        _appointment(
            db,
            patient,
            service=missed.service,
            when=rebooked_when,
            status=(
                AppointmentStatus.COMPLETED
                if rebooked_when < now
                else AppointmentStatus.CONFIRMED
            ),
            source=AppointmentSource.SMS,
            created_at=rebooked_created,
            provider=patient.preferred_provider,
            extra={"recovered_from": str(missed.id)},
        )
        appointments += 1
        _event(
            db,
            event_type=RetentionEventType.REBOOKED,
            patient=patient,
            created_at=rebooked_created,
        )
        events += 1

    return appointments, events


def _seed_cancellations(db, rng, patients, now) -> tuple[int, int]:
    """Late cancellations, and the one that was refilled.

    A cancellation is a different problem from a no-show — the slot is known
    to be empty in advance — and the console reports the two separately, so
    the demo has to contain both.
    """
    appointments = 0
    events = 0

    for index, patient in enumerate(patients[:4]):
        when = now - timedelta(days=rng.randint(4, 40))
        cancelled = _appointment(
            db,
            patient,
            service=rng.choice(SERVICES),
            when=when,
            status=AppointmentStatus.CANCELLED,
            source=AppointmentSource.STAFF,
            provider=patient.preferred_provider,
        )
        appointments += 1

        if index >= 2:
            continue

        offer_at = when + timedelta(hours=3)
        cancelled.reactivation_sent_at = offer_at
        _event(
            db,
            event_type=RetentionEventType.REACTIVATION_SENT,
            patient=patient,
            appointment=cancelled,
            created_at=offer_at,
        )
        events += 1

        if index >= 1:
            continue

        _appointment(
            db,
            patient,
            service=cancelled.service,
            when=when + timedelta(days=rng.randint(5, 12)),
            status=AppointmentStatus.COMPLETED,
            source=AppointmentSource.SMS,
            created_at=offer_at + timedelta(days=1),
            provider=patient.preferred_provider,
        )
        appointments += 1
        _event(db, event_type=RetentionEventType.REBOOKED, patient=patient,
               created_at=offer_at + timedelta(days=1))
        events += 1

    return appointments, events


def _seed_dormant_and_reactivation(db, rng, patients, now) -> tuple[int, int]:
    """Dormant clients, the reactivation campaign, and who came back.

    ``_attribution`` returns ``reactivated`` when the patient carries
    ``reactivation_sent_at`` before an agent-sourced booking — so these
    patients are given a genuinely old last visit and no prior no-show,
    which would otherwise take precedence.
    """
    appointments = 0
    events = 0

    for index, patient in enumerate(patients):
        last_visit = now - timedelta(days=rng.randint(70, 210))
        patient.last_visit_at = last_visit
        _appointment(
            db,
            patient,
            service=rng.choice(SERVICES),
            when=last_visit,
            status=AppointmentStatus.COMPLETED,
            source=AppointmentSource.STAFF,
            provider=patient.preferred_provider,
        )
        appointments += 1

        # Five of eight were contacted; three of those booked. Both ratios
        # are visible in the console and neither is written down anywhere.
        if index >= 5:
            continue

        sent_at = now - timedelta(days=rng.randint(4, 16))
        patient.reactivation_sent_at = sent_at
        _event(
            db,
            event_type=RetentionEventType.REACTIVATION_SENT,
            patient=patient,
            created_at=sent_at,
            # trigger="dormant" is how RetentionService distinguishes a
            # dormant-client campaign from an appointment recovery.
            metadata={"trigger": "dormant", "days_since_visit": (now - last_visit).days},
        )
        events += 1

        if index >= 3:
            continue

        booked_at = sent_at + timedelta(days=1)
        when = booked_at + timedelta(days=rng.randint(2, 9))
        _appointment(
            db,
            patient,
            service=rng.choice(SERVICES),
            when=when,
            status=(
                AppointmentStatus.COMPLETED if when < now else AppointmentStatus.CONFIRMED
            ),
            source=AppointmentSource.VOICE,
            created_at=booked_at,
            provider=patient.preferred_provider,
        )
        appointments += 1

    return appointments, events


def _seed_reminders_and_reviews(db, rng, patients, now) -> int:
    """The quiet, high-volume work: reminders going out, reviews coming back."""
    events = 0
    for patient in patients:
        appointments = (
            db.execute(select(Appointment).where(Appointment.patient_id == patient.id))
            .scalars()
            .all()
        )
        for appointment in appointments:
            if appointment.status in (AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED):
                _event(
                    db,
                    event_type=RetentionEventType.REMINDER_SENT,
                    patient=patient,
                    appointment=appointment,
                    created_at=appointment.scheduled_for - timedelta(days=1),
                )
                events += 1
            if appointment.status == AppointmentStatus.COMPLETED and rng.random() > 0.45:
                requested = appointment.scheduled_for + timedelta(
                    days=settings.review_request_delay_days
                )
                appointment.review_requested_at = requested
                _event(
                    db,
                    event_type=RetentionEventType.REVIEW_REQUESTED,
                    patient=patient,
                    appointment=appointment,
                    created_at=requested,
                )
                events += 1
                if rng.random() > 0.5:
                    appointment.review_received_at = requested + timedelta(days=1)
                    _event(
                        db,
                        event_type=RetentionEventType.REVIEW_RECEIVED,
                        patient=patient,
                        appointment=appointment,
                        channel="system",
                        created_at=appointment.review_received_at,
                    )
                    events += 1
    return events


def _seed_voice_calls(db, rng, patients, now) -> int:
    """Inbound calls the receptionist handled, with a realistic escalation rate.

    ``transcript`` is deliberately left null. The engine does not retain call
    transcripts, and a demo that shows one would be demonstrating a feature
    that does not exist and a privacy posture the product does not take.
    """
    outcomes = (
        [VoiceCallOutcome.BOOKED] * 8
        + [VoiceCallOutcome.FAQ] * 7
        + [VoiceCallOutcome.RESCHEDULED] * 3
        + [VoiceCallOutcome.CALLBACK_REQUESTED] * 3
        + [VoiceCallOutcome.TRANSFERRED] * 2
        + [VoiceCallOutcome.VOICEMAIL] * 2
        + [VoiceCallOutcome.ABANDONED] * 1
    )
    created = 0
    for index, outcome in enumerate(outcomes):
        patient = patients[index % len(patients)]
        started = now - timedelta(days=rng.randint(0, 56), hours=rng.randint(0, 22))
        call = VoiceCall(
            patient_id=patient.id,
            vapi_call_id=f"demo-call-{index:03d}",
            call_duration=rng.randint(48, 320),
            outcome=outcome,
            ended_reason="customer-ended-call",
            summary={DEMO_FLAG: True, "intent": rng.choice(SERVICES)},
        )
        db.add(call)
        db.flush()
        call.created_at = started
        call.ended_at = started + timedelta(seconds=call.call_duration)
        created += 1
    return created


def _since_midnight(rng: random.Random, now: datetime) -> datetime:
    """A moment earlier today.

    Subtracting a few hours from 'now' quietly lands yesterday when the demo
    is seeded in the early morning, and the Command Center's day counters read
    zero on a clinic that has plainly been busy.
    """
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elapsed = int((now - midnight).total_seconds())
    return midnight + timedelta(seconds=rng.randint(0, max(elapsed - 60, 60)))


def _seed_today(db, rng, patients, now) -> int:
    """A few hours of work in the last few hours.

    Without this the demo clinic is statistically quiet today — 64 enquiries
    spread across eight weeks averages about one a day — and the Command
    Center opens on a row of zeros. These are ordinary rows placed in the last
    few hours rather than special ones: the same calls and reminders the
    seeder writes everywhere else, positioned so a demo opened at 9am shows a
    clinic that is already awake.
    """
    created = 0
    for index, outcome in enumerate(
        [VoiceCallOutcome.BOOKED, VoiceCallOutcome.FAQ, VoiceCallOutcome.CALLBACK_REQUESTED]
    ):
        patient = patients[index % len(patients)]
        started = _since_midnight(rng, now)
        call = VoiceCall(
            patient_id=patient.id,
            vapi_call_id=f"demo-call-today-{index}",
            call_duration=rng.randint(60, 240),
            outcome=outcome,
            ended_reason="customer-ended-call",
            summary={DEMO_FLAG: True, "intent": rng.choice(SERVICES)},
        )
        db.add(call)
        db.flush()
        call.created_at = started
        call.ended_at = started + timedelta(seconds=call.call_duration)
        created += 1

    # Today's diary. A clinic with nothing booked today reads as closed.
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for index, patient in enumerate(patients[9:14]):
        _appointment(
            db,
            patient,
            service=rng.choice(SERVICES),
            when=midnight + timedelta(hours=settings.clinic_open_hour + index, minutes=30),
            status=AppointmentStatus.CONFIRMED,
            source=rng.choice([AppointmentSource.VOICE, AppointmentSource.WEB, AppointmentSource.STAFF]),
            created_at=now - timedelta(days=rng.randint(2, 11)),
            provider=patient.preferred_provider,
        )

    for index, patient in enumerate(patients[:9]):
        _event(
            db,
            event_type=RetentionEventType.REMINDER_SENT,
            patient=patient,
            created_at=_since_midnight(rng, now),
        )

    return created


def _seed_leads(db, rng, now) -> int:
    """Website and SMS enquiries, scored by the real qualification engine.

    Nothing here sets a score. Each lead is given answers and handed to
    :meth:`LeadService.qualify`, which scores it, routes it, and auto-books
    the hot ones through the ordinary booking path. The distribution of hot,
    warm and cold in the console is therefore an output of the product, not a
    property of the fixture.
    """
    from app.services.lead_service import LeadService

    service = LeadService(db)

    budgets = ["0-500", "500-1000", "1000-2000", "2000+"]
    timelines = ["asap", "1-2_weeks", "1_month", "browsing"]
    treatments = ["botox", "fillers", "laser", "facial", "peel"]

    created = 0
    for index in range(64):
        lead = service.get_or_create_by_session(f"demo-lead-{index:03d}")
        first = FIRST_NAMES[(index * 5) % len(FIRST_NAMES)]
        last = LAST_NAMES[(index * 3 + 1) % len(LAST_NAMES)]
        lead.set_name(f"{first} {last}")
        lead.set_phone(_fiction_number(_LEAD_AREA_CODE, index))
        lead.source = LeadSource.SMS if index % 5 == 0 else LeadSource.WEBSITE_CHAT

        state = dict(lead.conversation_state or {})
        state[DEMO_FLAG] = True
        lead.conversation_state = state

        # A realistic mix: plenty of serious enquiries, a long tail of
        # browsers, a handful of clinical flags.
        weighted = rng.random()
        if weighted < 0.22:
            lead.budget_range, lead.timeline = "2000+", "asap"
        elif weighted < 0.55:
            lead.budget_range = rng.choice(["1000-2000", "500-1000"])
            lead.timeline = rng.choice(["asap", "1-2_weeks"])
        else:
            lead.budget_range = rng.choice(budgets)
            lead.timeline = rng.choice(timelines)

        lead.treatment_interest = rng.choice(treatments)
        lead.previous_experience = rng.random() > 0.45
        lead.is_pregnant = index % 21 == 0          # ~3 clinical disqualifications
        lead.blood_thinner = index % 13 == 0        # ~5 provider approvals
        db.flush()

        # A slice never finished the questionnaire — the console should show
        # partial conversations, because a real clinic has them.
        if index % 9 == 4:
            lead.status = LeadStatus.QUALIFYING
            lead.timeline = None
            state = dict(lead.conversation_state or {})
            state["asking"] = "timeline"
            lead.conversation_state = state
        else:
            service.qualify(lead, notify=False)

        if index % 16 == 3:
            # Four of the sixty-four arrived earlier today.
            lead.created_at = _since_midnight(rng, now)
        else:
            lead.created_at = now - timedelta(
                days=rng.randint(1, 56), hours=rng.randint(0, 23)
            )
        if lead.qualified_at:
            lead.qualified_at = lead.created_at + timedelta(minutes=rng.randint(1, 9))
        created += 1

    db.flush()
    _realign_auto_booked_consultations(db, rng, now)
    db.commit()
    return created


def _realign_auto_booked_consultations(db: Session, rng: random.Random, now: datetime) -> None:
    """Move auto-booked consultations to when their lead actually enquired.

    Every hot lead is qualified inside one seeding run, so the booking adapter
    — correctly — offers them all the next free slots and the demo clinic ends
    up with eighteen consecutive consultations this afternoon. The booking
    path is genuinely exercised; only the clock is wrong. This walks the
    appointments the engine created and puts each one a day or two after its
    lead's enquiry, which is where it would have landed in real time.
    """
    appointments = (
        db.execute(
            select(Appointment).where(Appointment.service == "consultation")
        )
        .scalars()
        .all()
    )

    for appointment in appointments:
        lead_id = (appointment.extra or {}).get("lead_id")
        if not lead_id:
            continue
        lead = db.get(Lead, _as_uuid(lead_id))
        if lead is None or not str(lead.session_id or "").startswith("demo-"):
            continue

        booked_at = lead.created_at + timedelta(minutes=rng.randint(2, 40))
        scheduled = booked_at + timedelta(days=rng.randint(1, 6), hours=rng.randint(0, 6))

        appointment.created_at = booked_at
        appointment.scheduled_for = scheduled
        extra = dict(appointment.extra or {})
        extra[DEMO_FLAG] = True
        appointment.extra = extra

        if scheduled < now:
            # Most consultations are kept; a few are not, which is what gives
            # the recovery numbers something honest to work with.
            if rng.random() < 0.12:
                appointment.status = AppointmentStatus.NO_SHOW
            else:
                appointment.status = AppointmentStatus.COMPLETED
                appointment.completed_at = scheduled
        else:
            appointment.status = AppointmentStatus.CONFIRMED


def _as_uuid(value: Any):
    import uuid as _uuid

    try:
        return _uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return value
