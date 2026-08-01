import Link from "next/link";
import type { Metadata } from "next";
import { Inbox } from "lucide-react";

import { getOrderReviewQueue } from "@/lib/pharmacist";
import { formatPaise } from "@/lib/money";
import { RxBadge } from "@/components/rx-gate";
import { ScheduleType } from "@/generated/prisma/enums";

export const metadata: Metadata = {
  title: "Orders awaiting review",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OrderQueuePage() {
  const orders = await getOrderReviewQueue();

  if (orders.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-ink-100 p-12 text-center">
        <Inbox aria-hidden="true" className="mx-auto size-8 text-ink-300" />
        <p className="mt-2 text-sm text-ink-700">No orders awaiting review.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-ink-500">
        <span className="identifier">{orders.length}</span> order
        {orders.length === 1 ? "" : "s"} held for review, oldest first.
      </p>

      <ul className="mt-4 space-y-3">
        {orders.map((order) => (
          <li
            key={order.id}
            className={`rounded-[var(--radius-card)] border border-ink-100 p-4 ${
              order.containsH1Items ? "rx-gate" : "bg-paper-raised"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="identifier text-sm font-semibold text-pine-700">
                  {order.orderNumber}
                </p>
                <p className="text-xs text-ink-500">
                  {order.user.name ?? order.user.email} ·{" "}
                  <span className="identifier">
                    {formatPaise(order.totalPaise)}
                  </span>
                </p>
                <p className="identifier mt-0.5 text-[0.6875rem] text-ink-300">
                  Placed {order.placedAt.toLocaleString("en-IN")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {order.containsH1Items && <RxBadge />}
                <Link
                  href={`/pharmacist/orders/${order.id}`}
                  className="rounded-[var(--radius-control)] bg-pine-700 px-3 py-1.5 text-sm font-semibold text-paper hover:bg-pine-900"
                >
                  Review
                </Link>
              </div>
            </div>

            <ul className="mt-3 border-t border-ink-100 pt-2">
              {order.items.map((item) => (
                <li key={item.id} className="text-xs text-ink-700">
                  <span className="identifier text-ink-300">
                    {item.quantity}×
                  </span>{" "}
                  {item.nameSnapshot}
                  {item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1 && (
                    <span className="ml-1 font-semibold text-rx-700">H1</span>
                  )}
                  {item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H && (
                    <span className="ml-1 font-semibold text-rx-700">H</span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
