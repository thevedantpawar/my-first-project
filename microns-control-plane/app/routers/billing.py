"""Plans, checkout, the billing portal, and Stripe's webhook."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user, get_audit, require_owner
from app.models.user import User
from app.schemas import CheckoutRequest, CheckoutResponse, SubscriptionResponse
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
    try:
        url = billing.create_checkout_session(
            db, user.account, plan=payload.plan, email=user.email
        )
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except billing.BillingError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    db.commit()
    return CheckoutResponse(checkout_url=url)


@router.post("/portal", response_model=CheckoutResponse)
def open_portal(
    db: Session = Depends(get_db),
    user: User = Depends(require_owner),
) -> CheckoutResponse:
    """A link to Stripe's billing portal — cards, invoices, cancellation."""
    try:
        url = billing.create_portal_session(db, user.account)
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except billing.BillingError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    db.commit()
    return CheckoutResponse(checkout_url=url)


@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    db: Session = Depends(get_db),
) -> dict:
    """Receive a Stripe event.

    The signature is verified against the raw body before anything is parsed.
    Without that check, anyone who learns this URL can post a fabricated
    ``subscription.updated`` and grant themselves service indefinitely.

    A verified event that we do not handle still returns 200: a non-2xx makes
    Stripe retry, and retrying an event nobody wants achieves nothing.
    """
    payload = await request.body()

    try:
        event = billing.verify_webhook(payload, stripe_signature)
    except billing.BillingNotConfigured as exc:
        logger.error("Stripe webhook received but not configured: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except billing.BillingError as exc:
        logger.warning("Rejected a Stripe webhook: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    result = billing.handle_event(db, dict(event))
    logger.info("Stripe event %s handled=%s", result["type"], result["handled"])
    return {"received": True, **result}
