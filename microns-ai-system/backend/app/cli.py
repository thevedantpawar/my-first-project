"""Operator CLI.

    docker compose run --rm backend python -m app.cli gen-key
    docker compose run --rm backend python -m app.cli seed-demo
    docker compose run --rm backend python -m app.cli rotate-phi
    docker compose exec backend python -m app.cli audit-report --days 7
"""

from __future__ import annotations

import argparse
import secrets
import sys
from datetime import timedelta

from sqlalchemy import func, select

from app.config import settings


def cmd_gen_key(_args) -> int:
    """Print a fresh Fernet key and the other secrets a deployment needs."""
    from app.services.encryption import EncryptionService

    print(f"ENCRYPTION_KEY={EncryptionService.generate_key()}")
    print(f"FINGERPRINT_SECRET={secrets.token_urlsafe(48)}")
    print(f"INTERNAL_API_TOKEN={secrets.token_urlsafe(32)}")
    print(f"STAFF_API_TOKEN={secrets.token_urlsafe(32)}")
    print(f"N8N_ENCRYPTION_KEY={secrets.token_urlsafe(32)}")
    return 0


def cmd_seed_demo(args) -> int:
    """Create demo patients, appointments and leads.

    Useful for exercising the dashboard and the n8n workflows before a clinic's
    real data is loaded. Refuses to run in production.
    """
    if settings.is_production:
        print("Refusing to seed demo data in a production environment.", file=sys.stderr)
        return 1

    from app.database import SessionLocal, init_db
    from app.models.appointment import Appointment, AppointmentStatus
    from app.models.patient import Patient
    from app.services.lead_service import LeadService
    from app.utils import utcnow

    init_db()
    db = SessionLocal()
    try:
        now = utcnow()
        specimens = [
            ("Ava Thompson", "+15551230001", "botox", now + timedelta(hours=24), AppointmentStatus.CONFIRMED),
            ("Noah Patel", "+15551230002", "fillers", now + timedelta(hours=2), AppointmentStatus.CONFIRMED),
            ("Mia Rodriguez", "+15551230003", "laser", now - timedelta(days=1), AppointmentStatus.NO_SHOW),
            ("Liam Chen", "+15551230004", "facial", now - timedelta(days=6), AppointmentStatus.COMPLETED),
            ("Zoe Bennett", "+15551230005", "peel", now - timedelta(days=60), AppointmentStatus.COMPLETED),
        ]
        created = 0
        for name, phone, service, when, status in specimens:
            patient = Patient.create(phone=phone, name=name, sms_consent=True, marketing_consent=True)
            if status == AppointmentStatus.COMPLETED:
                patient.last_visit_at = when
            db.add(patient)
            db.flush()
            appointment = Appointment(
                patient_id=patient.id,
                service=service,
                scheduled_for=when,
                status=status,
                source="staff",
                completed_at=when if status == AppointmentStatus.COMPLETED else None,
            )
            db.add(appointment)
            created += 1
        db.commit()

        service = LeadService(db)
        for index, (interest, budget, timeline) in enumerate(
            [("botox", "2000+", "asap"), ("facial", "0-500", "browsing"), ("fillers", "1000-2000", "1-2_weeks")]
        ):
            lead = service.get_or_create_by_session(f"demo-{index}")
            lead.set_phone(f"+1555999000{index}")
            lead.set_name(f"Demo Lead {index}")
            lead.treatment_interest = interest
            lead.previous_experience = index % 2 == 0
            lead.is_pregnant = False
            lead.blood_thinner = index == 2
            lead.budget_range = budget
            lead.timeline = timeline
            db.flush()
            service.qualify(lead, notify=False)

        print(f"Seeded {created} patients/appointments and 3 leads.")
        return 0
    finally:
        db.close()


def cmd_demo(args) -> int:
    """Seed, clear or inspect the Glow Aesthetics demonstration clinic.

    Refuses to run in production — a fictional patient in a live clinic
    database is a data-integrity incident, and no sales demo is worth one.
    """
    from app.database import SessionLocal, init_db
    from app.services import demo_service

    init_db()
    db = SessionLocal()
    try:
        if args.action == "status":
            state = demo_service.demo_state(db)
            print(f"demo_mode:      {'on' if state['active'] else 'off'}")
            print(f"seeded:         {'yes' if state['seeded'] else 'no'}")
            print(f"demo patients:  {state['patients']}")
            return 0

        if args.action == "clear":
            removed = demo_service.clear(db)
            print("Cleared: " + ", ".join(f"{value} {key}" for key, value in removed.items()))
            return 0

        counts = demo_service.seed(db, replace=not args.keep)
        print(f"Seeded {counts.pop('clinic')}:")
        for key, value in counts.items():
            print(f"  {value:>4} {key.replace('_', ' ')}")
        print()
        print("Set DEMO_MODE=true so the console badges this data as a demonstration.")
        return 0
    except demo_service.DemoModeRefused as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        db.close()


def cmd_rotate_phi(_args) -> int:
    """Re-encrypt every PHI field under the current ENCRYPTION_KEY.

    Run after moving the old key into ``ENCRYPTION_KEYS_OLD`` and setting a new
    ``ENCRYPTION_KEY``. Reading decrypts with whichever key matches; writing
    always uses the newest, so a read-modify-write rotates the row.
    """
    from app.database import SessionLocal
    from app.models.lead import Lead
    from app.models.patient import Patient
    from app.models.voice_call import VoiceCall

    db = SessionLocal()
    rotated = 0
    try:
        for patient in db.execute(select(Patient)).scalars():
            patient.encrypted_name = patient.encrypted_name
            patient.encrypted_phone = patient.encrypted_phone
            patient.encrypted_email = patient.encrypted_email
            patient.encrypted_treatment_history = patient.encrypted_treatment_history
            rotated += 1
        for lead in db.execute(select(Lead)).scalars():
            lead.encrypted_name = lead.encrypted_name
            lead.encrypted_phone = lead.encrypted_phone
            lead.encrypted_email = lead.encrypted_email
            rotated += 1
        for call in db.execute(select(VoiceCall)).scalars():
            call.transcript = call.transcript
            call.encrypted_caller_number = call.encrypted_caller_number
            rotated += 1
        db.commit()
        print(f"Re-encrypted {rotated} record(s) under the current key.")
        print("You can now remove the retired key from ENCRYPTION_KEYS_OLD.")
        return 0
    finally:
        db.close()


def cmd_audit_report(args) -> int:
    """Summarise the audit trail — the report a compliance review asks for."""
    from app.database import SessionLocal
    from app.models.audit_log import AuditLog
    from app.utils import days_ago

    db = SessionLocal()
    try:
        since = days_ago(args.days)
        rows = db.execute(
            select(AuditLog.action, AuditLog.data_category, func.count(AuditLog.id))
            .where(AuditLog.timestamp >= since)
            .group_by(AuditLog.action, AuditLog.data_category)
            .order_by(func.count(AuditLog.id).desc())
        ).all()
        total = sum(row[2] for row in rows)
        print(f"Audit events in the last {args.days} day(s): {total}")
        print(f"{'ACTION':<20}{'CATEGORY':<24}COUNT")
        for action, category, count in rows:
            print(f"{action:<20}{category:<24}{count}")
        denied = db.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.timestamp >= since, AuditLog.outcome == "denied"
            )
        )
        if denied:
            print(f"\n⚠  {denied} denied access attempt(s) — review before signing off.")
        return 0
    finally:
        db.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli", description="Microns AI System operator CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("gen-key", help="generate encryption keys and API tokens").set_defaults(
        func=cmd_gen_key
    )
    subparsers.add_parser("seed-demo", help="insert demo patients, appointments and leads").set_defaults(
        func=cmd_seed_demo
    )
    demo_parser = subparsers.add_parser(
        "demo", help="seed, clear or inspect the Glow Aesthetics demo clinic"
    )
    demo_parser.add_argument(
        "action", choices=("seed", "clear", "status"), nargs="?", default="seed"
    )
    demo_parser.add_argument(
        "--keep", action="store_true", help="add to existing demo data instead of replacing it"
    )
    demo_parser.set_defaults(func=cmd_demo)

    subparsers.add_parser("rotate-phi", help="re-encrypt PHI under the current key").set_defaults(
        func=cmd_rotate_phi
    )
    audit_parser = subparsers.add_parser("audit-report", help="summarise the HIPAA audit trail")
    audit_parser.add_argument("--days", type=int, default=7)
    audit_parser.set_defaults(func=cmd_audit_report)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
