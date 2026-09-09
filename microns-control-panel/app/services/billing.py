"""Billing: Razorpay subscriptions, entitlement, and suspend/resume.

Razorpay owns the money; this module owns one question: should this account's
clinics still be serving traffic?

A billing problem **suspends, it never destroys** — losing entitlement scales
the engine to zero and leaves the database, its volume and every record
untouched. Regaining it is one call back.

"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.models.account import Account
from app.models.audit_event import AuditAction
from app.models.clinic import Clinic, ClinicStatus
from app.models.subscription import Subscription, SubscriptionStatus
from app.services import provisioning
from app.services.razorpay_client import (
    RazorpayClient,
    RazorpayError,
    RazorpayNotConfigured,
    verify_webhook_signature,
)
from app.utils import utcnow

logger = logging.getLogger(__name__)


class BillingError(RuntimeError):
    """A billing operation failed. The message is safe to show the user."""


class BillingNotConfigured(BillingError):
    """Razorpay is not configured on this deployment."""


#: What each plan allows. ``clinic_limit`` is enforced when a clinic is
#: created rather than when it is provisioned, so the limit is hit before any
#: infrastructure exists rather than halfway through building it.
PLANS: Dict[str, Dict[str, Any]] = {
    "starter": {
        "name": "Starter",
        "clinic_limit": 1,
        "plan_id_setting": "razorpay_plan_id_starter",
        "description": "One clinic, the full engine.",
    },
    "growth": {
        "name": "Growth",
        "clinic_limit": 5,
        "plan_id_setting": "razorpay_plan_id_growth",
        "description": "Up to five clinics under one account.",
    },
}


def plan_or_raise(plan: str) -> Dict[str, Any]:
    if plan not in PLANS:
        raise BillingError(f"Unknown plan '{plan}'. Choose one of: {', '.join(PLANS)}.")
    return PLANS[plan]


def plan_id_for(plan: str) -> str:
    config = plan_or_raise(plan)
    plan_id = getattr(settings, config["plan_id_setting"], None)
    if not plan_id:
        raise BillingNotConfigured(
            f"No Razorpay plan is configured for the {config['name']} plan. "
            f"Create it in the Razorpay dashboard and set "
            f"{config['plan_id_setting'].upper()}."
        )
    return plan_id


#: Razorpay's subscription states, mapped onto this system's.
#:
#: ``pending`` is the one worth reading twice. Razorpay uses it for a
#: subscription whose charge failed and is being retried — the same situation
#: Stripe calls ``past_due`` — so it entitles service. ``halted`` is where a
#: subscription lands once the retries are exhausted, and that does not.
#:
#: ``authenticated`` means the mandate is approved but the first charge has not
#: settled. During a delayed start (our trial) a subscription sits there, so it
#: maps to ``trialing`` and the clinic runs.
STATUS_FROM_RAZORPAY: Dict[str, str] = {
    "created": SubscriptionStatus.INCOMPLETE,
    "authenticated": SubscriptionStatus.TRIALING,
    "active": SubscriptionStatus.ACTIVE,
    "pending": SubscriptionStatus.PAST_DUE,
    "halted": SubscriptionStatus.UNPAID,
    "cancelled": SubscriptionStatus.CANCELED,
    "completed": SubscriptionStatus.CANCELED,
    "expired": SubscriptionStatus.CANCELED,
    "paused": SubscriptionStatus.CANCELED,
}


def _razorpay(client=None) -> RazorpayClient:
    """The API client, or a clear refusal."""
    if client is not None:
        return client
    try:
        return RazorpayClient()
    except RazorpayNotConfigured as exc:
        raise BillingNotConfigured(str(exc)) from exc


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
    db: Session, account: Account, *, plan: str, email: str, client=None
) -> Dict[str, Any]:
    """Create a Razorpay subscription and return its hosted authorisation page.

    Razorpay offers two ways to collect the mandate: its Checkout widget, which
    is a script loaded from checkout.razorpay.com, or the ``short_url`` on the
    subscription — a page Razorpay hosts. This uses the hosted page.

    The widget would be the more usual choice, and it is the wrong one here.
    This origin serves the sign-in form and reveals escrowed encryption keys,
    and the UI is deliberately built with no third-party scripts at all for that
    reason. Adding one to take a payment would put another party inside that
    boundary on every page that imports the billing module.

    The account id travels in ``notes``, which Razorpay echoes back on every
    webhook. That is how the account is found again without trusting anything
    the browser sends — somebody who navigates straight to the return URL has
    paid nothing, and the subscription stays ``created`` until Razorpay says
    otherwise.
    """
    api = _razorpay(client)
    razorpay_plan_id = plan_id_for(plan)
    subscription = get_or_create_subscription(db, account)

    # A trial is a start date in the future. Razorpay has no trial flag, and a
    # subscription starting now charges immediately.
    start_at = None
    if settings.razorpay_trial_days > 0:
        start_at = int(
            (utcnow() + timedelta(days=settings.razorpay_trial_days)).timestamp()
        )

    try:
        created = api.create_subscription(
            plan_id=razorpay_plan_id,
            total_count=settings.razorpay_total_count,
            start_at=start_at,
            notes={"account_id": str(account.id), "plan": plan},
        )
    except RazorpayError as exc:
        logger.exception("Razorpay checkout failed for account %s", account.id)
        raise BillingError(f"Could not start checkout: {exc}") from exc

    # Recorded now so a webhook that arrives before the browser finishes can
    # still find this row by subscription id.
    checkout_url = created.get("short_url")
    if not checkout_url:
        # Without it there is nowhere to send the customer. Better to fail here
        # than to hand the UI an empty link.
        raise BillingError(
            "Razorpay did not return an authorisation link for this subscription."
        )

    subscription.provider_subscription_id = created.get("id")
    subscription.provider_plan_id = razorpay_plan_id
    subscription.plan = plan
    subscription.clinic_limit = PLANS[plan]["clinic_limit"]
    if created.get("status"):
        subscription.status = STATUS_FROM_RAZORPAY.get(
            created["status"], subscription.status
        )
    db.flush()

    return {
        "checkout_url": checkout_url,
        "subscription_id": created.get("id"),
        "plan": plan,
    }


def cancel_subscription(db: Session, account: Account, *, client=None) -> Dict[str, Any]:
    """Cancel at the end of the paid period.

    Razorpay has no billing portal to hand this off to, so it is implemented
    here. At cycle end rather than immediately: the period is paid for, and
    cutting a clinic's phone line off the moment somebody clicks cancel is not
    what cancelling a subscription means anywhere else.

    Nothing is deprovisioned. Entitlement lapses when Razorpay says the
    subscription ended, and ``reconcile_clinics`` scales the engine to zero
    then — records, database and volume all stay.
    """
    api = _razorpay(client)
    subscription = get_or_create_subscription(db, account)
    if not subscription.provider_subscription_id:
        raise BillingError("This account has no subscription to cancel.")

    try:
        result = api.cancel_subscription(
            subscription.provider_subscription_id, at_cycle_end=True
        )
    except RazorpayError as exc:
        logger.exception("Razorpay cancellation failed for account %s", account.id)
        raise BillingError(f"Could not cancel the subscription: {exc}") from exc

    # Not marked cancelled locally. Razorpay keeps it active until the period
    # ends and says so in a webhook; writing "cancelled" here would suspend a
    # clinic the account has already paid for.
    return {
        "status": result.get("status"),
        "ends_at": _timestamp(result.get("current_end")),
        "cancelled_at_cycle_end": True,
    }


# --------------------------------------------------------------------------- #
# Webhooks
# --------------------------------------------------------------------------- #
def verify_webhook(payload: bytes, signature: Optional[str]) -> Dict[str, Any]:
    """Verify a webhook came from Razorpay, and return its parsed body.

    Without this, anyone who learns the URL can post a fabricated
    ``subscription.activated`` and grant themselves service indefinitely. The
    signature is the only thing between this endpoint and free infrastructure,
    so an unset secret is refused rather than skipped.

    The raw bytes are signed, so they are what gets verified — re-serialising
    the parsed JSON changes the whitespace, breaks the digest, and looks
    exactly like an attack.
    """
    if not settings.razorpay_webhook_secret:
        raise BillingNotConfigured("RAZORPAY_WEBHOOK_SECRET is not set.")
    if not signature:
        raise BillingError("Missing X-Razorpay-Signature header.")

    if not verify_webhook_signature(payload, signature, settings.razorpay_webhook_secret):
        raise BillingError("Signature does not match.")

    try:
        event = json.loads(payload)
    except ValueError as exc:
        raise BillingError("Webhook body is not JSON.") from exc
    if not isinstance(event, dict):
        raise BillingError("Webhook body is not a JSON object.")
    return event


def _timestamp(value: Optional[int]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromtimestamp(int(value), tz=timezone.utc).replace(tzinfo=None)


def _plan_from_provider_plan_id(plan_id: Optional[str]) -> Optional[str]:
    if not plan_id:
        return None
    for plan, config in PLANS.items():
        if getattr(settings, config["plan_id_setting"], None) == plan_id:
            return plan
    return None


def apply_subscription_state(
    db: Session, subscription_object: Dict[str, Any]
) -> Optional[Subscription]:
    """Update the local cache from a Razorpay subscription entity.

    The account is found by ``notes.account_id`` first, because the very first
    webhook can arrive before this row has been written with the subscription
    id — and by subscription id second, because ``notes`` can be edited in the
    Razorpay dashboard and a hand-typed one should not silently point at
    somebody else's account.
    """
    notes = subscription_object.get("notes") or {}
    account_id = notes.get("account_id")
    provider_subscription_id = subscription_object.get("id")

    query = db.query(Subscription)
    record = None
    if account_id:
        record = query.filter(Subscription.account_id == account_id).one_or_none()
    if record is None and provider_subscription_id:
        record = query.filter(
            Subscription.provider_subscription_id == provider_subscription_id
        ).one_or_none()

    if record is None:
        logger.warning(
            "Razorpay subscription %s does not match any account",
            provider_subscription_id,
        )
        return None

    provider_plan_id = subscription_object.get("plan_id")
    plan = _plan_from_provider_plan_id(provider_plan_id)

    record.provider_subscription_id = (
        provider_subscription_id or record.provider_subscription_id
    )
    record.provider_plan_id = provider_plan_id or record.provider_plan_id
    record.provider_customer_id = (
        subscription_object.get("customer_id") or record.provider_customer_id
    )

    raw_status = subscription_object.get("status")
    if raw_status:
        mapped = STATUS_FROM_RAZORPAY.get(raw_status)
        if mapped is None:
            # An unknown status must not silently entitle service. Razorpay can
            # add one, and defaulting to "keep whatever we had" is safer than
            # guessing in either direction — but it gets said out loud.
            logger.warning(
                "Unknown Razorpay subscription status %r on %s; leaving %s in place",
                raw_status,
                provider_subscription_id,
                record.status,
            )
        else:
            record.status = mapped

    record.current_period_end = _timestamp(subscription_object.get("current_end"))
    record.trial_ends_at = _timestamp(subscription_object.get("start_at"))
    record.canceled_at = _timestamp(subscription_object.get("ended_at"))

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


#: Razorpay events that carry a subscription entity worth acting on.
SUBSCRIPTION_EVENTS = {
    "subscription.activated",
    "subscription.charged",
    "subscription.pending",
    "subscription.halted",
    "subscription.cancelled",
    "subscription.completed",
    "subscription.paused",
    "subscription.resumed",
    "subscription.updated",
    "subscription.authenticated",
}


def handle_event(db: Session, event: Dict[str, Any], *, client=None) -> Dict[str, Any]:
    """Apply a verified Razorpay event.

    Only subscription-lifecycle events are acted on. Everything else is
    acknowledged and ignored — returning an error for an event we do not care
    about just makes Razorpay retry it for hours.
    """
    event_type = event.get("event", "")
    handled = False

    if event_type in SUBSCRIPTION_EVENTS:
        entity = (
            ((event.get("payload") or {}).get("subscription") or {}).get("entity") or {}
        )
        if entity:
            record = apply_subscription_state(db, entity)
            if record is not None:
                handled = True
                account = db.get(Account, record.account_id)
                if account is not None:
                    reconcile_clinics(db, account, client=client)

    elif event_type in {"payment.failed", "invoice.payment_failed"}:
        # Not acted on directly. Razorpay moves the subscription to `pending`
        # and then `halted` on its own retry schedule, and those arrive as
        # subscription events. Suspending on the first failed charge would cut
        # a clinic off before the card has even been retried.
        logger.info("Razorpay reported a failed payment (%s)", event_type)
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
    "cancel_subscription",
    "create_checkout_session",
    "describe",
    "get_or_create_subscription",
    "handle_event",
    "apply_subscription_state",
    "reconcile_clinics",
    "verify_webhook",
    "plan_id_for",
    "STATUS_FROM_RAZORPAY",
    "plan_or_raise",
]
