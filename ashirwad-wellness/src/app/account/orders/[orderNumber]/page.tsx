import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleDot, Circle } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { RxBadge } from "@/components/rx-gate";
import { ReorderButton, InvoiceLink } from "@/components/account-forms";
import { pharmacy } from "@/lib/pharmacy";
import { ScheduleType, OrderStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<OrderStatus, string> = {
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

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { orderNumber } = await params;

  const order = await db.order.findFirst({
    where: { orderNumber, userId: session.user.id },
    include: {
      items: { include: { prescription: { select: { id: true, status: true, doctorName: true } } } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!order) notFound();

  const address = order.shipAddressSnapshot as Record<string, string | null>;

  return (
    <div>
      <Link href="/account/orders" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-living-600">
        <ArrowLeft aria-hidden="true" className="size-3" />
        All orders
      </Link>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="identifier text-lg font-semibold text-pine-700">{order.orderNumber}</h2>
          <p className="text-xs text-ink-500">
            Placed {order.placedAt.toLocaleString("en-IN")} ·{" "}
            {order.paymentMethod === "COD" ? "Cash on delivery" : "Paid online"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <InvoiceLink orderNumber={order.orderNumber} />
          <ReorderButton orderId={order.id} />
        </div>
      </div>

      {order.status === OrderStatus.PHARMACIST_REJECTED && order.reviewRejectionReason && (
        <div className="rx-gate mt-4 rounded-r-[var(--radius-control)] p-3">
          <p className="text-sm font-semibold text-rx-700">Declined by the pharmacist</p>
          <p className="mt-1 text-xs text-rx-700">{order.reviewRejectionReason}</p>
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
          <h3 className="text-sm font-semibold text-ink">Items</h3>
          <ul className="mt-3 divide-y divide-ink-100">
            {order.items.map((item) => {
              const isRx =
                item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H ||
                item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1;
              return (
                <li key={item.id} className="py-3">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        <span className="identifier text-ink-300">{item.quantity}×</span> {item.nameSnapshot}
                      </p>
                      <p className="text-xs text-ink-500">{item.compositionSnapshot} · {item.packSizeSnapshot}</p>
                      <p className="identifier text-[0.625rem] text-ink-300">
                        {item.manufacturerSnapshot} · HSN {item.hsnCodeSnapshot}
                        {item.batchNumber && ` · batch ${item.batchNumber}`}
                        {item.expiryDate && ` · exp ${item.expiryDate.toLocaleDateString("en-IN")}`}
                      </p>
                      {isRx && (
                        <span className="mt-1 inline-block">
                          <RxBadge variant="quiet" />
                        </span>
                      )}
                    </div>
                    <span className="identifier shrink-0 text-sm text-ink-700">{formatPaise(item.lineTotalPaise)}</span>
                  </div>
                </li>
              );
            })}
          </ul>

          <dl className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink-500">Subtotal</dt><dd className="identifier text-ink-700">{formatPaise(order.subtotalPaise)}</dd></div>
            {order.discountPaise > 0 && (
              <div className="flex justify-between"><dt className="text-savings">Coupon {order.couponCode}</dt><dd className="identifier text-savings">−{formatPaise(order.discountPaise)}</dd></div>
            )}
            <div className="flex justify-between"><dt className="text-ink-500">Delivery</dt><dd className="identifier text-ink-700">{order.deliveryPaise === 0 ? "Free" : formatPaise(order.deliveryPaise)}</dd></div>
            <div className="flex justify-between border-t border-ink-100 pt-1.5 font-semibold"><dt className="text-ink">Total</dt><dd className="identifier text-pine-700">{formatPaise(order.totalPaise)}</dd></div>
            <p className="text-[0.6875rem] text-ink-300">Inclusive of GST ({formatPaise(order.gstPaise)})</p>
          </dl>
        </section>

        <div className="space-y-4">
          <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
            <h3 className="text-sm font-semibold text-ink">Progress</h3>
            <ol className="mt-3 space-y-3">
              {order.events.map((event, i) => {
                const isLatest = i === order.events.length - 1;
                return (
                  <li key={event.id} className="flex gap-2">
                    {isLatest ? (
                      <CircleDot aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-living-600" />
                    ) : (
                      <Circle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-ink-300" />
                    )}
                    <div className="min-w-0">
                      <p className={`text-xs ${isLatest ? "font-semibold text-ink" : "text-ink-700"}`}>
                        {STATUS_LABEL[event.toStatus]}
                      </p>
                      <p className="identifier text-[0.625rem] text-ink-300">
                        {event.createdAt.toLocaleString("en-IN")}
                      </p>
                      {event.note && <p className="text-[0.6875rem] text-ink-500">{event.note}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
            <h3 className="text-sm font-semibold text-ink">Delivered to</h3>
            <address className="mt-2 not-italic text-xs text-ink-500">
              <span className="block text-ink-700">{address.fullName}</span>
              <span className="block">{[address.line1, address.line2].filter(Boolean).join(", ")}</span>
              <span className="block">{address.city}, {address.state} <span className="identifier">{address.pincode}</span></span>
            </address>
          </section>

          <p className="text-[0.625rem] leading-relaxed text-ink-300">
            Dispensed by {pharmacy.tradeName} under drug licences{" "}
            <span className="identifier">{pharmacy.drugLicence20B}</span> and{" "}
            <span className="identifier">{pharmacy.drugLicence21B}</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
