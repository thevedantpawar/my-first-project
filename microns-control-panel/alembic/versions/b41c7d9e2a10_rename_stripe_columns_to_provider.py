"""Rename the subscription's stripe_* columns to provider_*

Billing moved from Stripe to Razorpay. The columns held processor ids either
way, so they are renamed rather than replaced — the alternative is a column
called stripe_customer_id holding a Razorpay id, which is how a schema starts
lying about itself.

Existing values are Stripe ids and are carried across as-is. There is nothing to
translate: an account that was billed by Stripe keeps its history, and its next
subscription overwrites these with Razorpay ids.

Revision ID: b41c7d9e2a10
Revises: aae39231e8fd
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "b41c7d9e2a10"
down_revision: Union[str, None] = "aae39231e8fd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RENAMES = [
    ("stripe_customer_id", "provider_customer_id"),
    ("stripe_subscription_id", "provider_subscription_id"),
    ("stripe_price_id", "provider_plan_id"),
]


#: Renaming a column does not rename the index on it — the index keeps its old
#: name in both PostgreSQL and SQLite, so a schema that otherwise looks right
#: still carries ix_subscriptions_stripe_customer_id. The autogenerate check in
#: test_migrations caught exactly that.
_INDEXES = [
    ("ix_subscriptions_stripe_customer_id", "ix_subscriptions_provider_customer_id",
     "provider_customer_id"),
    ("ix_subscriptions_stripe_subscription_id", "ix_subscriptions_provider_subscription_id",
     "provider_subscription_id"),
]


def upgrade() -> None:
    with op.batch_alter_table("subscriptions") as batch:
        for old, new in _RENAMES:
            batch.alter_column(old, new_column_name=new)

    for old_index, new_index, column in _INDEXES:
        op.drop_index(old_index, table_name="subscriptions")
        op.create_index(new_index, "subscriptions", [column])


def downgrade() -> None:
    for old_index, new_index, _ in _INDEXES:
        op.drop_index(new_index, table_name="subscriptions")

    with op.batch_alter_table("subscriptions") as batch:
        for old, new in _RENAMES:
            batch.alter_column(new, new_column_name=old)

    op.create_index(
        "ix_subscriptions_stripe_customer_id", "subscriptions", ["stripe_customer_id"]
    )
    op.create_index(
        "ix_subscriptions_stripe_subscription_id", "subscriptions", ["stripe_subscription_id"]
    )
