"""Module 6 — insurance verification status (staff-facing view).

The daily request job and the coordinator's-reply processing are triggered
from ``routers/internal.py`` (n8n/cron-facing); this router is just the
read side a front-desk dashboard would use to check "did this get verified
yet?" before a patient's chair time.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_audit, require_staff
from app.models.appointment import Appointment
from app.schemas import InsuranceReplyParsed, InsuranceVerificationOut
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger

router = APIRouter(prefix="/insurance", tags=["insurance"])


@router.get("/{appointment_id}", response_model=InsuranceVerificationOut)
def verification_status(
    appointment_id: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> InsuranceVerificationOut:
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    audit.log_read(str(appointment.patient_id), DataCategory.INSURANCE, user)

    parsed = None
    if appointment.insurance_verification_status == "verified":
        parsed = InsuranceReplyParsed(
            annual_max_remaining_cents=appointment.insurance_annual_max_remaining_cents,
            deductible_met=appointment.insurance_deductible_met,
            deductible_remaining_cents=appointment.insurance_deductible_remaining_cents,
            coverage_d0120_pct=appointment.insurance_coverage_d0120_pct,
            coverage_d1110_pct=appointment.insurance_coverage_d1110_pct,
            coverage_d4341_pct=appointment.insurance_coverage_d4341_pct,
            coverage_d2740_pct=appointment.insurance_coverage_d2740_pct,
            waiting_periods=appointment.insurance_waiting_periods,
            estimated_copay_cents=appointment.insurance_copay_cents,
        )
    return InsuranceVerificationOut(
        appointment_id=appointment_id,
        status=appointment.insurance_verification_status or "not_requested",
        parsed=parsed,
    )
