import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CalendarClock, PackageX } from "lucide-react";

import {
  getDashboardMetrics,
  getLowStockProducts,
  getExpiringBatches,
  NEAR_EXPIRY_DAYS,
} from "@/lib/admin";
import { formatPaise } from "@/lib/money";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  sub,
  href,
  urgent,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  urgent?: boolean;
}) {
  const body = (
    <div
      className={`rounded-[var(--radius-card)] border p-4 ${
        urgent
          ? "border-rx-100 bg-rx-50"
          : "border-ink-100 bg-paper-raised"
      }`}
    >
      <p className="text-xs text-ink-500">{label}</p>
      <p
        className={`identifier mt-1 text-2xl ${urgent ? "text-rx-700" : "text-pine-700"}`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[0.6875rem] text-ink-300">{sub}</p>}
    </div>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function AdminDashboard() {
  const [metrics, lowStock, expiring] = await Promise.all([
    getDashboardMetrics(),
    getLowStockProducts(10),
    getExpiringBatches(10),
  ]);

  const now = new Date();

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-base text-ink">Trading</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Revenue (all time)"
            value={formatPaise(metrics.totalRevenuePaise)}
            sub={`${metrics.paidOrders} orders`}
          />
          <Stat
            label="Revenue (30 days)"
            value={formatPaise(metrics.revenue30Paise)}
            sub={`${metrics.orders30} orders`}
          />
          <Stat
            label="Average order value"
            value={formatPaise(metrics.aovPaise)}
          />
          <Stat
            label="Schedule H1 dispensed"
            value={String(metrics.h1Dispensed)}
            sub="register entries"
            href="/pharmacist/register"
          />
        </div>
      </section>

      <section>
        <h2 className="text-base text-ink">Needs attention</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Prescriptions to verify"
            value={String(metrics.pendingPrescriptions)}
            href="/pharmacist"
            urgent={metrics.pendingPrescriptions > 0}
          />
          <Stat
            label="Orders held for review"
            value={String(metrics.pendingOrders)}
            href="/pharmacist/orders"
            urgent={metrics.pendingOrders > 0}
          />
          <Stat
            label="Low stock"
            value={String(metrics.lowStockCount)}
            href="/admin/inventory"
            urgent={metrics.lowStockCount > 0}
          />
          <Stat
            label="Expired stock"
            value={String(metrics.expiredCount)}
            sub={`${metrics.nearExpiryCount} near expiry`}
            href="/admin/inventory"
            urgent={metrics.expiredCount > 0}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <PackageX aria-hidden="true" className="size-3.5 text-turmeric-600" />
            Low stock
          </h2>

          {lowStock.length === 0 ? (
            <p className="mt-2 text-xs text-ink-500">Nothing below its alert level.</p>
          ) : (
            <ul className="mt-2 divide-y divide-ink-100">
              {lowStock.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <Link
                    href={`/admin/products/${p.id}`}
                    className="min-w-0 text-xs text-ink hover:text-living-600"
                  >
                    <span className="block truncate">{p.name}</span>
                    <span className="text-[0.625rem] text-ink-300">
                      {p.scheduleType}
                    </span>
                  </Link>
                  <span
                    className={`identifier shrink-0 text-xs font-semibold ${
                      p.stock === 0 ? "text-rx-700" : "text-turmeric-600"
                    }`}
                  >
                    {p.stock} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <CalendarClock aria-hidden="true" className="size-3.5 text-turmeric-600" />
            Expiry watch
          </h2>
          <p className="mt-0.5 text-[0.6875rem] text-ink-300">
            Batches expiring within {NEAR_EXPIRY_DAYS} days, or already expired.
          </p>

          {expiring.length === 0 ? (
            <p className="mt-2 text-xs text-ink-500">
              No batches recorded near expiry.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-ink-100">
              {expiring.map((batch) => {
                const isExpired = batch.expiryDate <= now;
                return (
                  <li
                    key={batch.id}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-xs text-ink">
                        {batch.product.name}
                      </span>
                      <span className="identifier text-[0.625rem] text-ink-300">
                        batch {batch.batchNumber} · {batch.quantity} units
                      </span>
                    </div>
                    <span
                      className={`identifier shrink-0 text-xs font-semibold ${
                        isExpired ? "text-rx-700" : "text-turmeric-600"
                      }`}
                    >
                      {isExpired && (
                        <AlertTriangle
                          aria-hidden="true"
                          className="mr-1 inline size-3"
                        />
                      )}
                      {batch.expiryDate.toLocaleDateString("en-IN")}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
