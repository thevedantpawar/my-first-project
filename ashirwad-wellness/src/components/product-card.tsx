import Link from "next/link";

import type { ProductCardData } from "@/lib/catalogue";
import { formatPaise, discountPercent, savingsPaise } from "@/lib/money";
import { RX_GATE_COPY } from "@/lib/schedule";
import { ProductImage } from "./product-image";
import { RxBadge } from "./rx-gate";
import { FORM_LABEL } from "@/lib/labels";

/**
 * Catalogue card — the first of the four surfaces the Rx Gate appears on
 * (card, product page, cart line, checkout line).
 *
 * A prescription product gets the full treatment: the `rx-gate` left rule and
 * tint on the card body, the ℞ badge, and the standard sentence. A non-Rx
 * product gets none of it. There is no middle state, and no surface may
 * restyle the markers — see src/components/rx-gate.tsx.
 */
export function ProductCard({ product }: { product: ProductCardData }) {
  const off = discountPercent(product.mrpPaise, product.sellingPricePaise);
  const saved = savingsPaise(product.mrpPaise, product.sellingPricePaise);
  const outOfStock = product.stock <= 0;
  const isRx = product.requiresPrescription;

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-ink-100 shadow-[var(--shadow-card)] transition-shadow focus-within:shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] ${
        isRx ? "rx-gate" : "bg-paper-raised"
      }`}
    >
      <div className="relative aspect-square overflow-hidden bg-paper-sunk">
        <ProductImage
          src={product.images[0]}
          name={product.brand?.name ?? product.name}
          slug={product.slug}
          label={FORM_LABEL[product.form]}
        />

        {/* The Rx badge owns the top of the tile alone. The discount badge sits
            bottom-right so the two can never collide on a narrow card — the
            prescription signal must never be the one that gets clipped. */}
        {isRx && (
          <div className="absolute left-2 top-2">
            <RxBadge />
          </div>
        )}

        {off > 0 && (
          <div className="absolute bottom-2 right-2 rounded-full bg-turmeric-500 px-2 py-0.5 text-[0.6875rem] font-bold text-ink-900">
            {off}% OFF
          </div>
        )}

        {outOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-paper/80">
            <span className="rounded-full bg-ink-700 px-3 py-1 text-xs font-semibold text-paper">
              Out of stock
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="text-sm font-semibold leading-snug text-ink">
          <Link
            href={`/product/${product.slug}`}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {product.name}
          </Link>
        </h3>

        {product.nameHi && (
          <p className="font-devanagari mt-0.5 text-xs text-ink-500">
            {product.nameHi}
          </p>
        )}

        <p className="mt-1 line-clamp-2 text-xs text-ink-500">
          {product.composition}
        </p>

        <p className="mt-0.5 text-[0.6875rem] text-ink-300">
          {product.brand?.name} · {product.packSize}
        </p>

        <div className="mt-auto pt-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="identifier text-base font-semibold text-pine-700">
              {formatPaise(product.sellingPricePaise)}
            </span>
            {off > 0 && (
              <span className="identifier text-xs text-ink-300 line-through">
                {formatPaise(product.mrpPaise)}
              </span>
            )}
          </div>

          {saved > 0 && (
            <p className="mt-0.5 text-[0.6875rem] font-semibold text-savings">
              You save {formatPaise(saved)}
            </p>
          )}

          {isRx ? (
            <p className="mt-2 border-t border-rx-100 pt-2 text-[0.6875rem] leading-snug text-rx-700">
              {RX_GATE_COPY.short}
            </p>
          ) : (
            !outOfStock && (
              <p className="mt-2 text-[0.6875rem] font-medium text-living-600">
                In stock
              </p>
            )
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products }: { products: ProductCardData[] }) {
  if (products.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
