import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { RxBadge } from "@/components/rx-gate";
import { ReorderButton, InvoiceLink } from "@/components/account-forms";
import { OrderStatus, ScheduleType } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Your orders", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<OrderStatus, string> = {
  DRAFT: "bg-ink-100 text-ink-500",
  PENDING_PHARMACIST_REVIEW: "bg-rx-100 text-rx-700",
  PHARMACIST_REJECTED: "bg-rx-500 text-paper",
  AWAITING_PAYMENT: "bg-turmeric-100 text-turmeric-600",
  CONFIRMED: "bg-living-100 text-living-600",
  PACKED: "bg-living-100 text-living-600",
  SHIPPED: "bg-living-100 text-living-600",
  OUT_FOR_DELIVERY: "bg-living-100 text-living-600",
  DELIVERED: "bg-pine-100 text-pine-700",
  CANCELLED: "bg-ink-100 text-ink-500",
  RETURNED: "bg-ink-100 text-ink-500",
};

export default async function OrdersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const orders = await db.order.findMany({
    where: { userId: session.user.id },
    include: { items: { select: { id: true, nameSnapshot: true, quantity: true, scheduleTypeSnapshot: true } } },
    orderBy: { placedAt: "desc" },
  });

  if (orders.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-ink-100 p-12 text-center">
        <p className="text-sm text-ink-700">You have no orders yet.</p>
        <Link href="/category/medicines" className="mt-2 inline-block text-sm text-living-600 hover:underline">
          Browse medicines
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {orders.map((order) => (
        <li
          key={order.id}
          className={`rounded-[var(--radius-card)] border border-ink-100 p-4 ${order.containsRxItems ? "rx-gate" : "bg-paper-raised"}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/account/orders/${order.orderNumber}`} className="identifier text-sm font-semibold text-pine-700 hover:underline">
                {order.orderNumber}
              </Link>
              <p className="identifier text-[0.6875rem] text-ink-300">
                {order.placedAt.toLocaleDateString("en-IN")} · {formatPaise(order.totalPaise)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {order.containsRxItems && <RxBadge variant="quiet" />}
              <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${STATUS_TONE[order.status]}`}>
                {order.status.toLowerCase().replace(/_/g, " ")}
              </span>
            </div>
          </div>

          <ul className="mt-2 border-t border-ink-100 pt-2">
            {order.items.map((item) => (
              <li key={item.id} className="text-xs text-ink-700">
                <span className="identifier text-ink-300">{item.quantity}×</span> {item.nameSnapshot}
                {item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1 && (
                  <span className="ml-1 font-semibold text-rx-700">H1</span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-start gap-2">
            <InvoiceLink orderNumber={order.orderNumber} />
            <ReorderButton orderId={order.id} />
          </div>
        </li>
      ))}
    </ul>
  );
}
