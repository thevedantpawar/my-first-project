import Link from "next/link";
import { TrendingDown } from "lucide-react";

import type { ProductCardData } from "@/lib/catalogue";
import { formatPaise, savingsPaise } from "@/lib/money";
import { RxBadge } from "./rx-gate";

/**
 * Cheaper equivalents with the same composition.
 *
 * This panel deliberately shows customers how to spend less with us. Generic
 * substitution is a legitimate and encouraged practice in Indian pharmacy, and
 * a catalogue that hides it is optimising against the customer.
 *
 * Two safety properties hold, enforced in getSaltSubstitutes rather than here:
 * substitutes always share the exact salt fingerprint (so combination drugs
 * only match the same combination at the same strengths), and always share the
 * schedule type (so a Schedule H drug is never shown as swappable for an OTC
 * one).
 */
export function SaltSubstitutes({
  substitutes,
  currentPricePaise,
  composition,
}: {
  substitutes: ProductCardData[];
  currentPricePaise: number;
  composition: string;
}) {
  const cheaper = substitutes.filter(
    (s) => s.sellingPricePaise < currentPricePaise,
  );

  if (substitutes.length === 0) return null;

  return (
    <section
      aria-labelledby="substitutes-heading"
      className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4 sm:p-5"
    >
      <div className="flex items-start gap-2">
        <TrendingDown
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-living-600"
        />
        <div>
          <h2 id="substitutes-heading" className="text-base text-ink">
            {cheaper.length > 0
              ? "Cheaper medicines with the same composition"
              : "Other medicines with the same composition"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Same salt, same strength —{" "}
            <span className="identifier">{composition}</span>. Ask your doctor
            or our pharmacist before switching brands.
          </p>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-ink-100">
        {substitutes.map((s) => {
          const saving = currentPricePaise - s.sellingPricePaise;

          return (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/product/${s.slug}`}
                  className="text-sm font-medium text-ink hover:text-living-600"
                >
                  {s.name}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-300">
                  <span>{s.brand?.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{s.packSize}</span>
                  {s.requiresPrescription && <RxBadge variant="quiet" />}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="identifier text-sm font-semibold text-pine-700">
                  {formatPaise(s.sellingPricePaise)}
                </p>
                {saving > 0 ? (
                  <p className="text-[0.6875rem] font-semibold text-savings">
                    Save {formatPaise(saving)}
                  </p>
                ) : saving < 0 ? (
                  <p className="text-[0.6875rem] text-ink-300">
                    {formatPaise(-saving)} more
                  </p>
                ) : (
                  <p className="text-[0.6875rem] text-ink-300">Same price</p>
                )}
                {savingsPaise(s.mrpPaise, s.sellingPricePaise) > 0 && (
                  <p className="text-[0.625rem] text-ink-300 line-through">
                    {formatPaise(s.mrpPaise)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
