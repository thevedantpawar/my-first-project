import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Upload } from "lucide-react";

import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { SCHEDULE_LABEL } from "@/lib/schedule";
import type { RawSearchParams } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Products",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";

  const products = await db.product.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { composition: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: {
      id: true,
      name: true,
      slug: true,
      scheduleType: true,
      requiresPrescription: true,
      mrpPaise: true,
      sellingPricePaise: true,
      stock: true,
      isActive: true,
      brand: { select: { name: true } },
    },
    orderBy: { name: "asc" },
    take: 100,
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search products…"
            className="rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-[var(--radius-control)] border border-pine-700 px-3 py-2 text-sm text-pine-700"
          >
            Search
          </button>
        </form>

        <div className="flex gap-2">
          <Link
            href="/admin/products/import"
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-ink-100 px-3 py-2 text-sm text-ink-700 hover:bg-pine-50"
          >
            <Upload aria-hidden="true" className="size-3.5" />
            Bulk import
          </Link>
          <Link
            href="/admin/products/new"
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-pine-700 px-3 py-2 text-sm font-semibold text-paper hover:bg-pine-900"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            New product
          </Link>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border border-ink-100">
        <table className="w-full min-w-[760px] border-collapse text-xs">
          <thead>
            <tr className="bg-pine-700 text-left text-paper">
              {["Product", "Schedule", "MRP", "Price", "Stock", "Status", ""].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr
                key={p.id}
                className={`border-t border-ink-100 ${
                  p.requiresPrescription ? "rx-gate" : "bg-paper-raised"
                }`}
              >
                <td className="px-3 py-2">
                  <span className="block text-ink">{p.name}</span>
                  <span className="text-[0.625rem] text-ink-300">
                    {p.brand?.name}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={p.requiresPrescription ? "font-semibold text-rx-700" : "text-ink-700"}
                  >
                    {SCHEDULE_LABEL[p.scheduleType]}
                  </span>
                </td>
                <td className="identifier px-3 py-2">{formatPaise(p.mrpPaise)}</td>
                <td className="identifier px-3 py-2">
                  {formatPaise(p.sellingPricePaise)}
                </td>
                <td className="identifier px-3 py-2">
                  <span className={p.stock === 0 ? "text-rx-700" : "text-ink-700"}>
                    {p.stock}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {p.isActive ? (
                    <span className="text-living-600">Listed</span>
                  ) : (
                    <span className="text-ink-300">Delisted</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/admin/products/${p.id}`}
                    className="text-living-600 hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {products.length === 100 && (
        <p className="mt-2 text-xs text-ink-300">
          Showing the first 100 matches. Refine the search to narrow it.
        </p>
      )}
    </div>
  );
}
