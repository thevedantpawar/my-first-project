import type { Metadata } from "next";
import Link from "next/link";

import { getRecentOrders } from "@/lib/admin";
import { formatPaise } from "@/lib/money";
import { OrderStatusControl } from "@/components/admin-tables";
import { OrderStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Mirrors ALLOWED_TRANSITIONS in src/actions/admin.ts. The server refuses
// anything not on this list, so this only decides what is offered.
const ALLOWED: Partial<Record<OrderStatus, OrderStatus[]>> = {
  CONFIRMED: [OrderStatus.PACKED, OrderStatus.CANCELLED],
  PACKED: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  SHIPPED: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RETURNED],
  OUT_FOR_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.RETURNED],
  DELIVERED: [OrderStatus.RETURNED],
  AWAITING_PAYMENT: [OrderStatus.CANCELLED],
};

export default async function AdminOrdersPage() {
  const orders = await getRecentOrders(50);

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-ink-100">
      <table className="w-full min-w-[860px] border-collapse text-xs">
        <thead>
          <tr className="bg-pine-700 text-left text-paper">
            {["Order", "Customer", "Total", "Payment", "Status", "Move"].map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className={`border-t border-ink-100 ${o.containsRxItems ? "rx-gate" : "bg-paper-raised"}`}>
              <td className="px-3 py-2">
                <Link href={`/pharmacist/orders/${o.id}`} className="identifier text-pine-700 hover:underline">
                  {o.orderNumber}
                </Link>
                <span className="block text-[0.625rem] text-ink-300">
                  {o.placedAt.toLocaleDateString("en-IN")}
                  {o.containsH1Items && <span className="ml-1 font-semibold text-rx-700">H1</span>}
                </span>
              </td>
              <td className="px-3 py-2 text-ink-700">{o.user.name ?? o.user.email}</td>
              <td className="identifier px-3 py-2">{formatPaise(o.totalPaise)}</td>
              <td className="px-3 py-2 text-ink-700">
                {o.paymentMethod === "COD" ? "COD" : "Online"}
                <span className="block text-[0.625rem] text-ink-300">{o.paymentStatus}</span>
              </td>
              <td className="px-3 py-2 text-ink-700">{o.status.toLowerCase().replace(/_/g, " ")}</td>
              <td className="px-3 py-2">
                <OrderStatusControl orderId={o.id} current={o.status} allowed={ALLOWED[o.status] ?? []} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length === 0 && <p className="p-8 text-center text-sm text-ink-500">No orders yet.</p>}
    </div>
  );
}
