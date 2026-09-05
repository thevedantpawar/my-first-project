import type { Metadata } from "next";

import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { CouponToggle } from "@/components/admin-tables";

export const metadata: Metadata = { title: "Coupons", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminCouponsPage() {
  const coupons = await db.coupon.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div>
      <p className="max-w-prose text-xs text-ink-500">
        Coupons exclude prescription medicines unless explicitly opted in.
        Discounting Rx medicines is a policy decision, so the default is not to.
      </p>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border border-ink-100">
        <table className="w-full min-w-[760px] border-collapse text-xs">
          <thead>
            <tr className="bg-pine-700 text-left text-paper">
              {["Code", "Discount", "Min order", "Used", "Applies to Rx", "Window", "Status"].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.id} className="border-t border-ink-100 bg-paper-raised">
                <td className="identifier px-3 py-2 font-semibold text-pine-700">{c.code}</td>
                <td className="px-3 py-2 text-ink-700">
                  {c.percentOff !== null
                    ? `${c.percentOff}%${c.maxDiscountPaise ? ` up to ${formatPaise(c.maxDiscountPaise)}` : ""}`
                    : formatPaise(c.flatOffPaise ?? 0)}
                </td>
                <td className="identifier px-3 py-2 text-ink-700">{formatPaise(c.minOrderPaise)}</td>
                <td className="identifier px-3 py-2 text-ink-700">
                  {c.usageCount}{c.usageLimit ? ` / ${c.usageLimit}` : ""}
                </td>
                <td className="px-3 py-2">
                  {c.appliesToRxItems
                    ? <span className="font-semibold text-rx-700">Yes</span>
                    : <span className="text-ink-500">No</span>}
                </td>
                <td className="identifier px-3 py-2 text-[0.625rem] text-ink-500">
                  {c.startsAt.toLocaleDateString("en-IN")} – {c.endsAt.toLocaleDateString("en-IN")}
                </td>
                <td className="px-3 py-2">
                  <CouponToggle code={c.code} isActive={c.isActive} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
