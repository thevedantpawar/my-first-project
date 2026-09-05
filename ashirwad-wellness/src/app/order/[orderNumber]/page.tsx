import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, Truck, FileSearch } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { RxBadge } from "@/components/rx-gate";
import { H1_CITATION } from "@/lib/schedule";
import { pharmacy } from "@/lib/pharmacy";
import { ScheduleType, OrderStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = {
  title: "Order confirmed",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<OrderStatus, string> = {
  DRAFT: "Draft",
  PENDING_PHARMACIST_REVIEW: "Awaiting pharmacist review",
  PHARMACIST_REJECTED: "Declined by pharmacist",
  AWAITING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
};

export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { orderNumber } = await params;

  const order = await db.order.findFirst({
    // Scoped to the signed-in customer: an order number is guessable and must
    // not be enough on its own to read someone else's order.
    where: { orderNumber, userId: session.user.id },
    include: {
      items: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!order) notFound();

  const address = order.shipAddressSnapshot as Record<string, string | null>;
  const awaitingReview = order.status === OrderStatus.PENDING_PHARMACIST_REVIEW;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-start gap-3">
        <CheckCircle2
          aria-hidden="true"
          className="mt-0.5 size-7 shrink-0 text-living-500"
        />
        <div>
          <h1 className="text-2xl text-ink">Order placed</h1>
          <p className="mt-1 text-sm text-ink-500">
            Order number{" "}
            <span className="identifier font-semibold text-pine-700">
              {order.orderNumber}
            </span>
          </p>
        </div>
      </div>

      {awaitingReview && (
        <div className="rx-gate mt-6 rounded-r-[var(--radius-card)] p-4">
          <div className="flex items-start gap-2">
            <FileSearch
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-rx-500"
            />
            <div>
              <p className="text-sm font-semibold text-rx-700">
                Waiting for pharmacist review
              </p>
              <p className="mt-1 text-xs leading-relaxed text-rx-700">
                Your order contains prescription medicines. A registered
                pharmacist will check your prescription against the items
                ordered before anything is dispensed. We will email you as soon
                as that is done — usually within a few hours during pharmacy
                opening times.
              </p>
              {order.containsH1Items && (
                <p className="identifier mt-2 text-[0.625rem] text-rx-700">
                  {H1_CITATION}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Clock aria-hidden="true" className="size-3.5 text-pine-700" />
            Status
          </h2>
          <p className="mt-2 text-sm text-ink-700">{STATUS_COPY[order.status]}</p>
          <ol className="mt-3 space-y-1.5">
            {order.events.map((event) => (
              <li key={event.id} className="text-xs text-ink-500">
                <span className="identifier text-ink-300">
                  {event.createdAt.toLocaleString("en-IN")}
                </span>{" "}
                — {STATUS_COPY[event.toStatus]}
                {event.note ? ` (${event.note})` : ""}
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Truck aria-hidden="true" className="size-3.5 text-pine-700" />
            Delivering to
          </h2>
          <address className="mt-2 not-italic text-sm text-ink-700">
            <span className="block">{address.fullName}</span>
            <span className="block text-ink-500">
              {address.line1}
              {address.line2 ? `, ${address.line2}` : ""}
            </span>
            <span className="block text-ink-500">
              {address.city}, {address.state}{" "}
              <span className="identifier">{address.pincode}</span>
            </span>
            <span className="identifier block text-xs text-ink-300">
              {address.phone}
            </span>
          </address>
        </section>
      </div>

      <section className="mt-4 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Items</h2>
        <ul className="mt-3 divide-y divide-ink-100">
          {order.items.map((item) => {
            const isRx =
              item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H ||
              item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1;

            return (
              <li key={item.id} className="flex gap-3 py-2.5">
                <span className="identifier shrink-0 text-sm text-ink-300">
                  {item.quantity}×
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{item.nameSnapshot}</p>
                  <p className="text-xs text-ink-500">{item.compositionSnapshot}</p>
                  <p className="text-[0.6875rem] text-ink-300">
                    {item.manufacturerSnapshot} · {item.packSizeSnapshot} · HSN{" "}
                    <span className="identifier">{item.hsnCodeSnapshot}</span>
                  </p>
                  {isRx && (
                    <span className="mt-1 inline-block">
                      <RxBadge variant="quiet" />
                    </span>
                  )}
                </div>
                <span className="identifier shrink-0 text-sm text-ink-700">
                  {formatPaise(item.lineTotalPaise)}
                </span>
              </li>
            );
          })}
        </ul>

        <dl className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-500">Subtotal</dt>
            <dd className="identifier text-ink-700">
              {formatPaise(order.subtotalPaise)}
            </dd>
          </div>
          {order.discountPaise > 0 && (
            <div className="flex justify-between">
              <dt className="text-savings">
                Coupon{" "}
                <span className="identifier">{order.couponCode}</span>
              </dt>
              <dd className="identifier text-savings">
                −{formatPaise(order.discountPaise)}
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-500">Delivery</dt>
            <dd className="identifier text-ink-700">
              {order.deliveryPaise === 0 ? "Free" : formatPaise(order.deliveryPaise)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-ink-100 pt-1.5 font-semibold">
            <dt className="text-ink">Total</dt>
            <dd className="identifier text-pine-700">
              {formatPaise(order.totalPaise)}
            </dd>
          </div>
          <p className="text-[0.6875rem] text-ink-300">
            Inclusive of GST ({formatPaise(order.gstPaise)}) ·{" "}
            {order.paymentMethod === "COD" ? "Cash on delivery" : "Paid online"}
          </p>
        </dl>
      </section>

      <p className="mt-4 text-[0.6875rem] leading-relaxed text-ink-500">
        Dispensed by {pharmacy.tradeName} under drug licences{" "}
        <span className="identifier">{pharmacy.drugLicence20B}</span> and{" "}
        <span className="identifier">{pharmacy.drugLicence21B}</span>. Registered
        pharmacist: {pharmacy.pharmacistName} (
        <span className="identifier">{pharmacy.pharmacistRegNo}</span>).
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/account/orders"
          className="rounded-[var(--radius-control)] bg-pine-700 px-4 py-2.5 text-sm font-semibold text-paper hover:bg-pine-900"
        >
          View your orders
        </Link>
        <Link
          href="/"
          className="rounded-[var(--radius-control)] border border-ink-100 px-4 py-2.5 text-sm text-ink-700 hover:bg-pine-50"
        >
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
