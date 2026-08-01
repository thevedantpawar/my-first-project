import Link from "next/link";
import { ArrowRight, RotateCcw } from "lucide-react";

import { auth } from "@/auth";
import {
  getCategoryTree,
  getOfferRail,
  getReorderSuggestions,
} from "@/lib/catalogue";
import { ProductGrid } from "@/components/product-card";
import { TrustStrip } from "@/components/trust-strip";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();

  const [categories, offers, reorder] = await Promise.all([
    getCategoryTree(),
    getOfferRail(10),
    session?.user?.id ? getReorderSuggestions(session.user.id) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-[var(--radius-card)] bg-pine-700 px-6 py-10 sm:px-10 sm:py-14">
        <h1 className="max-w-2xl text-2xl leading-tight text-paper sm:text-4xl">
          Medicines dispensed by a pharmacist, not by an algorithm.
        </h1>
        <p className="mt-3 max-w-xl text-sm text-pine-100 sm:text-base">
          Every prescription is checked by a registered pharmacist before your
          order is dispensed. Delivering across Nashik.
        </p>
        <Link
          href="/category/medicines"
          className="mt-6 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-living-500 px-5 py-2.5 text-sm font-semibold text-paper hover:bg-living-600"
        >
          Browse medicines
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </section>

      <div className="mt-6">
        <TrustStrip />
      </div>

      {/* Returning customers land on their repeat medication, not on a banner. */}
      {reorder.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <RotateCcw aria-hidden="true" className="size-4 text-pine-700" />
            <h2 className="text-lg text-ink">Order again</h2>
          </div>
          <ProductGrid products={reorder} />
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg text-ink">Shop by category</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((category) => (
            <div
              key={category.id}
              className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4 shadow-[var(--shadow-card)]"
            >
              <h3 className="text-sm font-semibold text-pine-700">
                <Link href={`/category/${category.slug}`}>{category.name}</Link>
              </h3>
              <ul className="mt-2 space-y-1">
                {category.children.slice(0, 4).map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/category/${child.slug}`}
                      className="text-xs text-ink-500 hover:text-living-600"
                    >
                      {child.name}
                      <span className="identifier ml-1 text-ink-300">
                        {child._count.products}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg text-ink">Best savings today</h2>
          <Link
            href="/search?sort=discount"
            className="text-sm text-living-600 hover:underline"
          >
            See all
          </Link>
        </div>
        <ProductGrid products={offers} />
      </section>
    </div>
  );
}
