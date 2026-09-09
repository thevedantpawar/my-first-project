"""Plans, checkout, cancellation, and Razorpay's webhook."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user, get_audit, require_owner
from app.models.user import User
from app.schemas import (
    CancelResponse,
    CheckoutRequest,
    CheckoutResponse,
    SubscriptionResponse,
)
from app.services import billing
from app.services.audit import AuditAction, AuditLogger

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.get("/plans")
def list_plans() -> dict:
    """The plans on offer. Public — this is the pricing page's data."""
    return {
        "plans": [
            {
                "id": plan_id,
                "name": config["name"],
                "clinic_limit": config["clinic_limit"],
                "description": config["description"],
            }
            for plan_id, config in billing.PLANS.items()
        ]
    }


@router.get("/subscription", response_model=SubscriptionResponse)
def get_subscription(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> SubscriptionResponse:
    return SubscriptionResponse(**billing.describe(db, user.account))


@router.post("/checkout", response_model=CheckoutResponse)
def start_checkout(
    payload: CheckoutRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_owner),
) -> CheckoutResponse:
    """Create the Razorpay subscription the browser will open Checkout with."""
    try:
        handle = billing.create_checkout_session(
            db, user.account, plan=payload.plan, email=user.email
        )
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except billing.BillingError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    db.commit()
    return CheckoutResponse(**handle)


@router.post("/cancel", response_model=CancelResponse)
def cancel(
    db: Session = Depends(get_db),
    user: User = Depends(require_owner),
    audit: AuditLogger = Depends(get_audit),
) -> CancelResponse:
    """Cancel at the end of the paid period.

    Razorpay has no billing portal to hand this off to, so it lives here. The
    account keeps its clinics until the period Razorpay has already charged for
    runs out.
    """
    try:
        result = billing.cancel_subscription(db, user.account)
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except billing.BillingError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    audit.log(AuditAction.SUBSCRIPTION_CANCELLED, user=user)
    db.commit()
    return CancelResponse(**result)


@router.post("/webhook", include_in_schema=False)
async def razorpay_webhook(
    request: Request,
    razorpay_signature: str | None = Header(default=None, alias="X-Razorpay-Signature"),
    db: Session = Depends(get_db),
) -> dict:
    """Receive a Razorpay event.

    The signature is verified against the raw body before anything is parsed.
    Without that check, anyone who learns this URL can post a fabricated
    ``subscription.activated`` and grant themselves service indefinitely.

    A verified event we do not handle still returns 200: a non-2xx makes
    Razorpay retry for hours, and retrying an event nobody wants achieves
    nothing.
    """
    payload = await request.body()

    try:
        event = billing.verify_webhook(payload, razorpay_signature)
    except billing.BillingNotConfigured as exc:
        logger.error("Razorpay webhook received but not configured: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except billing.BillingError as exc:
        logger.warning("Rejected a Razorpay webhook: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    result = billing.handle_event(db, event)
    logger.info("Razorpay event %s handled=%s", result["type"], result["handled"])
    return {"received": True, **result}
