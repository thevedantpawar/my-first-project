import { db } from "@/lib/db";
import { SiteFooter } from "@/components/site-footer";
import { RxBadge, RxGateBlock } from "@/components/rx-gate";
import { formatPaise, discountPercent } from "@/lib/money";
import { SCHEDULE_LABEL } from "@/lib/schedule";
import { ScheduleType } from "@/generated/prisma/enums";

/**
 * Phase 1 landing page.
 *
 * Deliberately plain — Phase 2 builds the real home page (category grid, offer
 * rail, reorder shortcut). What this page exists to show is that the tokens,
 * the fonts and the Rx Gate render, and that the catalogue is real.
 */

export const dynamic = "force-dynamic";

export default async function Home() {
  const [total, rxCount, h1Count, categories, sample] = await Promise.all([
    db.product.count(),
    db.product.count({ where: { requiresPrescription: true } }),
    db.product.count({ where: { scheduleType: ScheduleType.SCHEDULE_H1 } }),
    db.category.count(),
    db.product.findMany({
      where: { slug: { in: ["crocin-advance-500mg-tablet", "zifi-200-tablet"] } },
      include: { brand: true, manufacturer: true },
      orderBy: { requiresPrescription: "asc" },
    }),
  ]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-100 bg-paper-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <p className="font-display text-xl text-pine-700">
              Ashirwad Wellness
            </p>
            <p className="text-xs text-ink-500">Nashik, Maharashtra</p>
          </div>
          <span className="identifier rounded-full bg-pine-50 px-3 py-1 text-xs text-pine-700">
            Phase 1 — foundation
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="max-w-2xl text-3xl leading-tight text-ink sm:text-4xl">
          A pharmacy platform built around the prescription, not around the
          shopping cart.
        </h1>

        <dl className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Products seeded", value: total },
            { label: "Prescription-only", value: rxCount },
            { label: "Schedule H1", value: h1Count },
            { label: "Categories", value: categories },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4 shadow-[var(--shadow-card)]"
            >
              <dt className="text-xs text-ink-500">{stat.label}</dt>
              <dd className="identifier mt-1 text-2xl text-pine-700">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        <section className="mt-14">
          <h2 className="text-xl text-ink">The Rx Gate</h2>
          <p className="mt-2 max-w-prose text-sm text-ink-500">
            One treatment, reused verbatim on the catalogue card, the product
            page, the cart line and the checkout line. The{" "}
            <code className="identifier text-rx-700">--rx</code> colour appears
            nowhere else in the application, so the colour itself becomes the
            signal.
          </p>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {sample.map((p) => {
              const off = discountPercent(p.mrpPaise, p.sellingPricePaise);
              const card = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{p.name}</p>
                      {p.nameHi && (
                        <p className="font-devanagari text-sm text-ink-500">
                          {p.nameHi}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-ink-500">
                        {p.composition}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-300">
                        {p.brand?.name} · {p.manufacturer.name}
                      </p>
                    </div>
                    {p.requiresPrescription ? (
                      <RxBadge />
                    ) : (
                      <span className="rounded-full bg-living-50 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-living-600">
                        In stock
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="identifier text-lg text-pine-700">
                      {formatPaise(p.sellingPricePaise)}
                    </span>
                    <span className="identifier text-sm text-ink-300 line-through">
                      {formatPaise(p.mrpPaise)}
                    </span>
                    {off > 0 && (
                      <span className="text-xs font-semibold text-savings">
                        {off}% off
                      </span>
                    )}
                  </div>

                  <p className="mt-2 text-xs text-ink-500">
                    {SCHEDULE_LABEL[p.scheduleType]} · {p.packSize}
                  </p>
                </>
              );

              return p.requiresPrescription ? (
                <div
                  key={p.id}
                  className="overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised shadow-[var(--shadow-card)]"
                >
                  <div className="p-4">{card}</div>
                  <div className="px-4 pb-4">
                    <RxGateBlock scheduleType={p.scheduleType} tone="short" />
                  </div>
                </div>
              ) : (
                <div
                  key={p.id}
                  className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4 shadow-[var(--shadow-card)]"
                >
                  {card}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
