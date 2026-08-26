"""Patient lookup and creation.

Phone number is the identity key for a dental practice: it is what the voice
agent hears, what Twilio delivers, and what the patient gives at the front
desk. Since the stored value is encrypted with a random IV, every lookup goes
through the deterministic fingerprint rather than a decrypt-and-compare scan.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.patient import Patient
from app.services.encryption import get_encryption_service, normalise_identifier
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger

logger = logging.getLogger(__name__)


def find_by_phone(db: Session, phone: Optional[str]) -> Optional[Patient]:
    if not phone:
        return None
    fingerprint = get_encryption_service().fingerprint(phone)
    return db.execute(
        select(Patient).where(Patient.phone_fingerprint == fingerprint)
    ).scalar_one_or_none()


def find_by_email(db: Session, email: Optional[str]) -> Optional[Patient]:
    if not email:
        return None
    fingerprint = get_encryption_service().fingerprint(email)
    return db.execute(
        select(Patient).where(Patient.email_fingerprint == fingerprint)
    ).scalars().first()


def get_or_create_patient(
    db: Session,
    *,
    phone: str,
    name: Optional[str] = None,
    email: Optional[str] = None,
    member_id: Optional[str] = None,
    insurance_provider: Optional[str] = None,
    external_id: Optional[str] = None,
    sms_consent: bool = True,
    audit: Optional[HIPAAAuditLogger] = None,
    user_id: str = "system",
) -> tuple[Patient, bool]:
    """Return ``(patient, created)``.

    Existing records are enriched, never overwritten: a caller that only knows
    the phone number must not blank out a name captured earlier.
    """
    audit = audit or HIPAAAuditLogger(db)
    patient = find_by_phone(db, phone)

    if patient is not None:
        changed = False
        if name and not patient.encrypted_name:
            patient.encrypted_name = name
            changed = True
        if email and not patient.encrypted_email:
            patient.set_email(email)
            changed = True
        if member_id and not patient.encrypted_member_id:
            patient.encrypted_member_id = member_id
            changed = True
        if insurance_provider and not patient.insurance_provider:
            patient.insurance_provider = insurance_provider
            changed = True
        if external_id and not patient.external_id:
            patient.external_id = external_id
            changed = True
        if sms_consent and not patient.sms_consent:
            patient.sms_consent = True
            changed = True
        if changed:
            db.flush()
            audit.log_write(str(patient.id), DataCategory.CONTACT, user_id, details={"enriched": True})
        else:
            audit.log_read(str(patient.id), DataCategory.CONTACT, user_id)
        return patient, False

    patient = Patient.create(
        phone=normalise_identifier(phone),
        name=name,
        email=email,
        member_id=member_id,
        insurance_provider=insurance_provider,
        sms_consent=sms_consent,
        external_id=external_id,
    )
    db.add(patient)
    db.flush()
    audit.log_write(str(patient.id), DataCategory.CONTACT, user_id, details={"created": True})
    logger.info("Created patient %s", patient.id)
    return patient, True


__all__ = ["find_by_phone", "find_by_email", "get_or_create_patient"]
