import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

import { db } from "@/lib/db";
import { getExpiringBatches, getLowStockProducts, NEAR_EXPIRY_DAYS } from "@/lib/admin";
import { AddBatchForm } from "@/components/admin-tables";

export const metadata: Metadata = { title: "Inventory", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminInventoryPage() {
  const [batches, lowStock, products] = await Promise.all([
    getExpiringBatches(100),
    getLowStockProducts(50),
    db.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const now = new Date();

  return (
    <div className="space-y-6">
      <AddBatchForm products={products} />

      <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <h2 className="text-sm font-semibold text-ink">
          Expiry watch — within {NEAR_EXPIRY_DAYS} days
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          Expired stock must not be dispensed. Batches are listed soonest first.
        </p>

        {batches.length === 0 ? (
          <p className="mt-3 text-xs text-ink-500">No batches near expiry.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100">
            {batches.map((b) => {
              const expired = b.expiryDate <= now;
              return (
                <li key={b.id} className={`flex items-center justify-between gap-3 py-2 ${expired ? "rx-gate rounded-r-[var(--radius-control)] px-2" : ""}`}>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink">{b.product.name}</p>
                    <p className="identifier text-[0.625rem] text-ink-300">
                      batch {b.batchNumber} · {b.quantity} units · {b.product.scheduleType}
                    </p>
                  </div>
                  <span className={`identifier shrink-0 text-xs font-semibold ${expired ? "text-rx-700" : "text-turmeric-600"}`}>
                    {expired && <AlertTriangle aria-hidden="true" className="mr-1 inline size-3" />}
                    {b.expiryDate.toLocaleDateString("en-IN")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Low stock</h2>
        {lowStock.length === 0 ? (
          <p className="mt-3 text-xs text-ink-500">Nothing below its alert level.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100">
            {lowStock.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-xs text-ink">{p.name}</span>
                <span className={`identifier shrink-0 text-xs font-semibold ${p.stock === 0 ? "text-rx-700" : "text-turmeric-600"}`}>
                  {p.stock} / alert at {p.lowStockAlert}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
