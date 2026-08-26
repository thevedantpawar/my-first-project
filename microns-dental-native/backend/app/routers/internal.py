"""Internal endpoints — the daily/polling jobs behind every module's drip.

These are what a cron container (or, if a practice wants n8n orchestrating
this backend instead of using the self-contained ``n8n-workflows/``, an n8n
Schedule Trigger) calls on a timer. Every route requires
``X-Internal-Token``. See the README's "Running the daily jobs" section for
the exact cron lines.
"""

from __future__ import annotations

import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_audit, require_internal_token
from app.schemas import ActionResult
from app.services.gmail_service import get_gmail_service
from app.services.hipaa_audit import HIPAAAuditLogger
from app.services.insurance_service import InsuranceService
from app.services.lead_service import LeadService
from app.services.retention_service import RetentionService
from app.services.treatment_plan_service import TreatmentPlanService

router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(require_internal_token)])


# --------------------------------------------------------------------- #
# Module 1 — hygiene recall
# --------------------------------------------------------------------- #
@router.post("/recalls/process-due", response_model=ActionResult)
def process_due_recalls(db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit)) -> ActionResult:
    """Daily job: advance every active recall whose next-action date has arrived."""
    results = RetentionService(db, audit).process_all_due_recalls()
    return ActionResult(status="ok", data={"processed": len(results), "results": results})


# --------------------------------------------------------------------- #
# Module 2 — treatment-plan follow-up
# --------------------------------------------------------------------- #
@router.post("/treatment-plans/process-due", response_model=ActionResult)
def process_due_plans(db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit)) -> ActionResult:
    """Daily job: draft the next stage's SMS for every plan due today."""
    results = TreatmentPlanService(db, audit).process_all_due_plans()
    return ActionResult(status="ok", data={"processed": len(results), "results": results})


@router.post("/treatment-plans/poll-approvals", response_model=ActionResult)
def poll_treatment_plan_approvals(db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit)) -> ActionResult:
    """Poll Gmail for a dentist's forward/reply to an ``[APPROVE-TP-...]`` draft.

    A true push (Gmail ``watch`` + Pub/Sub) is more responsive but needs a GCP
    Pub/Sub topic — this poll is the zero-extra-infrastructure default; see
    the README for wiring up push instead.
    """
    messages = get_gmail_service().search_replies(subject_contains="[APPROVE-TP-")
    service = TreatmentPlanService(db, audit)
    results = []
    for message in messages:
        match = re.search(r"\[APPROVE-TP-([0-9a-fA-F]{12})\]", message.get("subject", ""))
        if not match:
            continue
        results.append(service.approve_by_tag(match.group(1)))
    return ActionResult(status="ok", data={"checked": len(messages), "results": results})


# --------------------------------------------------------------------- #
# Module 3 — review request & response
# --------------------------------------------------------------------- #
@router.post("/reviews/process-due", response_model=ActionResult)
def process_due_reviews(db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit)) -> ActionResult:
    """Daily job: send the 24h review request, or re-check GBP at the 5-day mark."""
    service = RetentionService(db, audit)
    results = [service.process_review(row.id) for row in service.due_reviews()]
    return ActionResult(status="ok", data={"processed": len(results), "results": results})


@router.post("/reviews/poll-approvals", response_model=ActionResult)
def poll_review_approvals(db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit)) -> ActionResult:
    """Poll Gmail for a dentist's approval of an ``[APPROVE-REVIEW-...]`` draft."""
    messages = get_gmail_service().search_replies(subject_contains="[APPROVE-REVIEW-")
    service = RetentionService(db, audit)
    results = []
    for message in messages:
        match = re.search(r"\[APPROVE-REVIEW-([0-9a-fA-F-]{36})\]", message.get("subject", ""))
        if not match:
            continue
        try:
            results.append(service.approve_review_response(UUID(match.group(1))))
        except ValueError:
            continue
    return ActionResult(status="ok", data={"checked": len(messages), "results": results})


# --------------------------------------------------------------------- #
# Module 5 — lead nurture drip
# --------------------------------------------------------------------- #
@router.post("/leads/nurture/process-due", response_model=ActionResult)
def process_due_nurture(db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit)) -> ActionResult:
    service = LeadService(db, audit)
    results = [service.send_nurture(lead.id) for lead in service.due_nurture_leads()]
    return ActionResult(status="ok", data={"processed": len(results), "results": results})


# --------------------------------------------------------------------- #
# Module 6 — insurance verification
# --------------------------------------------------------------------- #
@router.post("/insurance/request-tomorrow", response_model=ActionResult)
def request_tomorrows_verifications(db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit)) -> ActionResult:
    """Daily 4pm job: draft a verification request for each new-patient appt tomorrow."""
    results = InsuranceService(db, audit).request_verifications_for_tomorrow()
    return ActionResult(status="ok", data={"requested": len(results), "results": results})


@router.post("/insurance/poll-replies", response_model=ActionResult)
def poll_insurance_replies(db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit)) -> ActionResult:
    """Poll Gmail for the coordinator's reply to a ``[VERIFY-...]`` request."""
    messages = get_gmail_service().search_replies(subject_contains="[VERIFY-")
    service = InsuranceService(db, audit)
    results = []
    for message in messages:
        appointment_id = service.parse_verify_tag(message.get("subject", ""))
        if appointment_id is None:
            continue
        try:
            reply_text = get_gmail_service().get_message_body(message["id"])
        except Exception:
            continue
        results.append(service.process_reply(appointment_id=appointment_id, reply_text=reply_text or message.get("snippet", "")))
    return ActionResult(status="ok", data={"checked": len(messages), "results": results})
