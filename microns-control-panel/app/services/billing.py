"""Stripe subscriptions, and what they entitle.

Stripe owns the money. This module owns one question: should this account's
clinics still be serving traffic? That has to be answerable without a network
call on every request, so Stripe's view is cached in the ``subscriptions`` table
and kept current by webhook.

The rule that shapes everything here is that **a billing problem must never
destroy clinical data**. A failed card suspends — the engine scales to zero,
the database and its volume stay exactly where they are, and resuming is one
call. Nothing in this module deletes a clinic. Deprovisioning is a separate,
deliberate, operator action.

``PAST_DUE`` still entitles service. A card that expired this morning should
not take a clinic's phone line down this afternoon; Stripe's own dunning gets
its retry window first.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.models.account import Account
from app.models.audit_event import AuditAction
from app.models.clinic import Clinic, ClinicStatus
from app.models.subscription import Subscription, SubscriptionStatus
from app.services import provisioning
from app.utils import utcnow

logger = logging.getLogger(__name__)


class BillingError(RuntimeError):
    """A billing operation failed. The message is safe to show the user."""


class BillingNotConfigured(BillingError):
    """Stripe is not configured on this deployment."""


#: What each plan allows. ``clinic_limit`` is enforced when a clinic is
#: created rather than when it is provisioned, so the limit is hit before any
#: infrastructure exists rather than halfway through building it.
PLANS: Dict[str, Dict[str, Any]] = {
    "starter": {
        "name": "Starter",
        "clinic_limit": 1,
        "price_id_setting": "stripe_price_id_starter",
        "description": "One clinic, the full engine.",
    },
    "growth": {
        "name": "Growth",
        "clinic_limit": 5,
        "price_id_setting": "stripe_price_id_growth",
        "description": "Up to five clinics under one account.",
    },
}


def plan_or_raise(plan: str) -> Dict[str, Any]:
    if plan not in PLANS:
        raise BillingError(f"Unknown plan '{plan}'. Choose one of: {', '.join(PLANS)}.")
    return PLANS[plan]


def price_id_for(plan: str) -> str:
    config = plan_or_raise(plan)
    price_id = getattr(settings, config["price_id_setting"], None)
    if not price_id:
        raise BillingNotConfigured(
            f"No Stripe price is configured for the {config['name']} plan."
        )
    return price_id


def _stripe():
    """The Stripe SDK, configured. Imported lazily so the app runs without it."""
    if not settings.stripe_api_key:
        raise BillingNotConfigured(
            "Stripe is not configured — set STRIPE_API_KEY to take payments."
        )
    import stripe as stripe_sdk

    stripe_sdk.api_key = settings.stripe_api_key
    return stripe_sdk


def get_or_create_subscription(db: Session, account: Account) -> Subscription:
    """The account's subscription row, created if somehow absent.

    Signup creates one, so this is a safety net rather than the normal path —
    but every entitlement check goes through it, and a null check scattered
    across callers is a null check somebody eventually forgets.
    """
    # Queried rather than read off ``account.subscription``: this runs from
    # webhook handlers where the Account was loaded before the row changed, and
    # a stale relationship would silently answer the entitlement question wrong.
    existing = (
        db.query(Subscription).filter(Subscription.account_id == account.id).one_or_none()
    )
    if existing is not None:
        return existing

    subscription = Subscription(
        account_id=account.id,
        status=SubscriptionStatus.NONE,
        plan="starter",
        clinic_limit=PLANS["starter"]["clinic_limit"],
    )
    db.add(subscription)
    db.flush()
    return subscription


def clinics_used(db: Session, account: Account) -> int:
    """Clinics counting against the plan limit.

    Archived clinics do not count — an account that tried one and shut it down
    should not be permanently down a slot. Everything else does, including
    suspended and failed ones, because both still hold infrastructure.
    """
    return (
        db.query(Clinic)
        .filter(Clinic.account_id == account.id, Clinic.status != ClinicStatus.ARCHIVED)
        .count()
    )


def can_add_clinic(db: Session, account: Account) -> tuple[bool, Optional[str]]:
    """Whether this account may create another clinic, and why not."""
    subscription = get_or_create_subscription(db, account)

    if not subscription.is_entitled:
        return False, (
            "This account does not have an active subscription. "
            "Choose a plan to add a clinic."
        )

    used = clinics_used(db, account)
    if used >= subscription.clinic_limit:
        plan_name = PLANS.get(subscription.plan, {}).get("name", subscription.plan)
        return False, (
            f"The {plan_name} plan includes {subscription.clinic_limit} "
            f"clinic{'s' if subscription.clinic_limit != 1 else ''}, and "
            f"{used} {'is' if used == 1 else 'are'} in use. Upgrade to add another."
        )

    return True, None


# --------------------------------------------------------------------------- #
# Checkout
# --------------------------------------------------------------------------- #
def create_checkout_session(
    db: Session, account: Account, *, plan: str, email: str
) -> str:
    """Start a Stripe Checkout session and return its URL.

    The account id travels in ``client_reference_id`` and in metadata so the
    webhook can find the account again without trusting anything the browser
    sends back. The success URL is a signal to the UI, never the thing that
    grants access — a user who navigates straight to it has paid nothing.
    """
    stripe_sdk = _stripe()
    price_id = price_id_for(plan)
    subscription = get_or_create_subscription(db, account)

    base = settings.public_base_url.rstrip("/")
    try:
        session = stripe_sdk.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            client_reference_id=str(account.id),
            customer=subscription.stripe_customer_id or None,
            customer_email=None if subscription.stripe_customer_id else email,
            subscription_data={
                "trial_period_days": settings.stripe_trial_days or None,
                "metadata": {"account_id": str(account.id), "plan": plan},
            },
            metadata={"account_id": str(account.id), "plan": plan},
            success_url=f"{base}/clinics?checkout=success",
            cancel_url=f"{base}/billing?checkout=cancelled",
        )
    except Exception as exc:  # noqa: BLE001 - the SDK raises a wide family
        logger.exception("Stripe checkout failed for account %s", account.id)
        raise BillingError(f"Could not start checkout: {type(exc).__name__}") from exc

    return session.url


def create_portal_session(db: Session, account: Account) -> str:
    """A Stripe billing portal link, for cards, invoices and cancellation.

    Cancellation lives in Stripe's portal rather than being rebuilt here: it
    already handles proration, invoices and tax, and a second implementation
    would be a second thing that can disagree with Stripe.
    """
    stripe_sdk = _stripe()
    subscription = get_or_create_subscription(db, account)
    if not subscription.stripe_customer_id:
        raise BillingError("This account has no billing history yet.")

    try:
        session = stripe_sdk.billing_portal.Session.create(
            customer=subscription.stripe_customer_id,
            return_url=f"{settings.public_base_url.rstrip('/')}/billing",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Stripe portal failed for account %s", account.id)
        raise BillingError(f"Could not open the billing portal: {type(exc).__name__}") from exc

    return session.url


# --------------------------------------------------------------------------- #
# Webhooks
# --------------------------------------------------------------------------- #
def verify_webhook(payload: bytes, signature: Optional[str]):
    """Verify a webhook came from Stripe.

    Without this, anyone who learns the URL can post a fabricated
    ``subscription.updated`` and grant themselves service indefinitely. The
    signature is the only thing standing between this endpoint and free
    infrastructure, so an unset secret is refused rather than skipped.
    """
    if not settings.stripe_webhook_secret:
        raise BillingNotConfigured("STRIPE_WEBHOOK_SECRET is not set.")
    if not signature:
        raise BillingError("Missing Stripe-Signature header.")

    stripe_sdk = _stripe()
    try:
        return stripe_sdk.Webhook.construct_event(
            payload, signature, settings.stripe_webhook_secret
        )
    except Exception as exc:  # noqa: BLE001 - includes signature and parse errors
        raise BillingError("Stripe webhook signature verification failed.") from exc


def _timestamp(value: Optional[int]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromtimestamp(int(value), tz=timezone.utc).replace(tzinfo=None)


def _plan_from_price(price_id: Optional[str]) -> Optional[str]:
    """Map a Stripe price back to a local plan name."""
    if not price_id:
        return None
    for plan, config in PLANS.items():
        if getattr(settings, config["price_id_setting"], None) == price_id:
            return plan
    return None


def apply_subscription_state(
    db: Session, subscription_object: Dict[str, Any]
) -> Optional[Subscription]:
    """Update the local cache from a Stripe subscription object.

    The account is found by metadata rather than by the customer id, because
    the very first webhook can arrive before the customer id has been stored.
    """
    account_id = (subscription_object.get("metadata") or {}).get("account_id")
    customer_id = subscription_object.get("customer")

    query = db.query(Subscription)
    record = None
    if account_id:
        record = query.filter(Subscription.account_id == account_id).one_or_none()
    if record is None and customer_id:
        record = query.filter(Subscription.stripe_customer_id == customer_id).one_or_none()

    if record is None:
        logger.warning(
            "Stripe subscription %s does not match any account",
            subscription_object.get("id"),
        )
        return None

    items = (subscription_object.get("items") or {}).get("data") or []
    price_id = (items[0].get("price") or {}).get("id") if items else None
    plan = _plan_from_price(price_id)

    record.stripe_customer_id = customer_id or record.stripe_customer_id
    record.stripe_subscription_id = subscription_object.get("id") or record.stripe_subscription_id
    record.stripe_price_id = price_id or record.stripe_price_id
    record.status = subscription_object.get("status") or record.status
    record.current_period_end = _timestamp(subscription_object.get("current_period_end"))
    record.trial_ends_at = _timestamp(subscription_object.get("trial_end"))
    record.canceled_at = _timestamp(subscription_object.get("canceled_at"))

    if plan:
        record.plan = plan
        record.clinic_limit = PLANS[plan]["clinic_limit"]

    return record


def reconcile_clinics(db: Session, account: Account, *, client=None) -> list[Clinic]:
    """Bring an account's clinics into line with what it is entitled to.

    Suspends when entitlement lapses, resumes when it returns. Never deletes:
    the whole point of scaling to zero is that a card problem is reversible and
    a clinic's records outlive it.
    """
    subscription = get_or_create_subscription(db, account)
    entitled = subscription.is_entitled
    changed: list[Clinic] = []

    # Queried directly for the same reason as above — the relationship on an
    # Account loaded earlier in the request does not see a clinic added since.
    clinics = db.query(Clinic).filter(Clinic.account_id == account.id).all()
    for clinic in clinics:
        if not entitled and clinic.status == ClinicStatus.ACTIVE:
            provisioning.suspend(
                db,
                clinic,
                reason=f"Subscription is {subscription.status}.",
                client=client,
            )
            changed.append(clinic)
        elif entitled and clinic.status == ClinicStatus.SUSPENDED:
            try:
                provisioning.resume(db, clinic, client=client)
                changed.append(clinic)
            except Exception:  # noqa: BLE001 - one clinic must not block the rest
                logger.exception("Could not resume clinic %s", clinic.slug)

    return changed


def handle_event(db: Session, event: Dict[str, Any], *, client=None) -> Dict[str, Any]:
    """Apply a verified Stripe event.

    Only the subscription-lifecycle events are acted on. Everything else is
    acknowledged and ignored — returning an error for an event we do not care
    about just makes Stripe retry it.
    """
    event_type = event.get("type", "")
    data = (event.get("data") or {}).get("object") or {}
    handled = False

    if event_type in {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.trial_will_end",
    }:
        record = apply_subscription_state(db, data)
        if record is not None:
            handled = True
            account = db.get(Account, record.account_id)
            if account is not None:
                reconcile_clinics(db, account, client=client)

    elif event_type == "checkout.session.completed":
        account_id = data.get("client_reference_id") or (data.get("metadata") or {}).get(
            "account_id"
        )
        if account_id:
            record = (
                db.query(Subscription)
                .filter(Subscription.account_id == account_id)
                .one_or_none()
            )
            if record is not None:
                record.stripe_customer_id = data.get("customer") or record.stripe_customer_id
                record.stripe_subscription_id = (
                    data.get("subscription") or record.stripe_subscription_id
                )
                plan = (data.get("metadata") or {}).get("plan")
                if plan in PLANS:
                    record.plan = plan
                    record.clinic_limit = PLANS[plan]["clinic_limit"]
                handled = True

    elif event_type == "invoice.payment_failed":
        # Not acted on directly. Stripe moves the subscription to past_due and
        # then to unpaid on its own schedule, and those transitions arrive as
        # subscription.updated. Suspending on the first failed charge would cut
        # a clinic off before Stripe has even retried the card.
        logger.info("Invoice payment failed for customer %s", data.get("customer"))
        handled = True

    db.commit()
    return {"type": event_type, "handled": handled}


def describe(db: Session, account: Account) -> Dict[str, Any]:
    """The subscription as the owner sees it."""
    subscription = get_or_create_subscription(db, account)
    return {
        "plan": subscription.plan,
        "status": subscription.status,
        "is_entitled": subscription.is_entitled,
        "clinic_limit": subscription.clinic_limit,
        "clinics_used": clinics_used(db, account),
        "trial_ends_at": subscription.trial_ends_at,
        "current_period_end": subscription.current_period_end,
    }


__all__ = [
    "PLANS",
    "BillingError",
    "BillingNotConfigured",
    "can_add_clinic",
    "clinics_used",
    "create_checkout_session",
    "create_portal_session",
    "describe",
    "get_or_create_subscription",
    "handle_event",
    "apply_subscription_state",
    "reconcile_clinics",
    "verify_webhook",
    "price_id_for",
    "plan_or_raise",
]
