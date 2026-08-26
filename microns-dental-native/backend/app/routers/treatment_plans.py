"""Module 2 endpoints — treatment-plan follow-up (``/retention/treatment-plans``).

Matches the spec's ``Backend Endpoints (/retention/treatment-plans/)`` list.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_audit, require_staff
from app.models.treatment_plan import TreatmentPlan, TreatmentPlanStatus
from app.schemas import ActionResult, ApproveFollowupRequest, TreatmentPlanCreate, TreatmentPlanOut
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.treatment_plan_service import TreatmentPlanService
from app.utils import mask_name

router = APIRouter(prefix="/retention/treatment-plans", tags=["treatment-plans"])


def _to_out(plan: TreatmentPlan) -> TreatmentPlanOut:
    return TreatmentPlanOut(
        treatment_plan_id=plan.id, patient_uuid=plan.patient_id,
        display_name=mask_name(plan.presenting_appointments[0].patient.name) if plan.presenting_appointments else "Patient",
        total_value_cents=plan.total_value_cents, status=plan.status, followup_count=plan.followup_count,
        presentation_date=plan.presentation_date, scheduled_date=plan.scheduled_date,
    )


@router.get("", response_model=list[TreatmentPlanOut])
def list_active(
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[TreatmentPlanOut]:
    """List all active, unscheduled treatment plans."""
    rows = db.execute(
        select(TreatmentPlan)
        .where(TreatmentPlan.status.in_((TreatmentPlanStatus.ACTIVE, TreatmentPlanStatus.AWAITING_APPROVAL)))
        .order_by(TreatmentPlan.next_action_date)
    ).scalars().all()
    audit.log_read(None, DataCategory.TREATMENT_PLAN, user, details={"count": len(rows)})
    return [_to_out(row) for row in rows]


@router.post("", response_model=TreatmentPlanOut, status_code=201)
def create_plan(
    payload: TreatmentPlanCreate,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> TreatmentPlanOut:
    """Manually log a treatment plan a dentist presented at the chair."""
    plan = TreatmentPlanService(db, audit).create_plan(
        patient_id=payload.patient_uuid, procedures=payload.procedures,
        total_value_cents=payload.total_value_cents, presentation_date=payload.presentation_date,
        appointment_id=payload.appointment_id,
    )
    return _to_out(plan)


@router.get("/converted", response_model=list[TreatmentPlanOut])
def converted(
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[TreatmentPlanOut]:
    """Converted treatment plans with recovered value."""
    rows = db.execute(
        select(TreatmentPlan).where(TreatmentPlan.status == TreatmentPlanStatus.CONVERTED)
        .order_by(TreatmentPlan.converted_at.desc())
    ).scalars().all()
    audit.log_read(None, DataCategory.TREATMENT_PLAN, user, details={"count": len(rows)})
    return [_to_out(row) for row in rows]


@router.get("/expired", response_model=list[TreatmentPlanOut])
def expired(
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[TreatmentPlanOut]:
    """Expired treatment plans — the lost-revenue list."""
    rows = db.execute(
        select(TreatmentPlan).where(TreatmentPlan.status == TreatmentPlanStatus.EXPIRED)
        .order_by(TreatmentPlan.expired_at.desc())
    ).scalars().all()
    audit.log_read(None, DataCategory.TREATMENT_PLAN, user, details={"count": len(rows)})
    return [_to_out(row) for row in rows]


@router.get("/{treatment_plan_id}", response_model=TreatmentPlanOut)
def get_plan(
    treatment_plan_id: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> TreatmentPlanOut:
    plan = db.get(TreatmentPlan, treatment_plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Treatment plan not found")
    audit.log_read(str(plan.patient_id), DataCategory.TREATMENT_PLAN, user)
    return _to_out(plan)


@router.post("/{treatment_plan_id}/approve-sms", response_model=ActionResult)
def approve_sms(
    treatment_plan_id: UUID,
    payload: Optional[ApproveFollowupRequest] = None,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> ActionResult:
    """Approve and send the currently-drafted follow-up SMS for this plan.

    Mirrors the Gmail forward/reply approval path for staff who prefer a
    dashboard button over email — both call
    :meth:`TreatmentPlanService.approve_by_tag`.
    """
    plan = db.get(TreatmentPlan, treatment_plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Treatment plan not found")
    result = TreatmentPlanService(db, audit).approve_by_tag(plan.approval_tag)
    return ActionResult(status=result.get("status", "ok"), data=result)
