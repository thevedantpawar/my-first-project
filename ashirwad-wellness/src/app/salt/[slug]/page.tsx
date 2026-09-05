import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { getProductsBySalt } from "@/lib/search";
import { ProductGrid } from "@/components/product-card";
import { formatPaise } from "@/lib/money";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await getProductsBySalt(slug);
  if (!result) return { title: "Salt not found" };

  return {
    title: `${result.salt.name} — all brands`,
    description: `Compare every brand containing ${result.salt.name}, cheapest first.`,
  };
}

/**
 * Salt listing — every brand containing one molecule, cheapest first.
 *
 * This is the page a customer wants when the doctor wrote a molecule rather
 * than a brand, and the page that makes generic substitution obvious.
 */
export default async function SaltPage({ params }: Props) {
  const { slug } = await params;
  const result = await getProductsBySalt(slug);
  if (!result) notFound();

  const { salt, products } = result;
  const cheapest = products[0];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <p className="text-xs uppercase tracking-wide text-ink-300">
        Active ingredient
      </p>
      <h1 className="mt-1 text-2xl text-ink sm:text-3xl">{salt.name}</h1>

      <p className="mt-2 max-w-prose text-sm text-ink-500">
        <span className="identifier">{products.length}</span>{" "}
        {products.length === 1 ? "product contains" : "products contain"}{" "}
        {salt.name}
        {cheapest && (
          <>
            , starting at{" "}
            <span className="identifier font-semibold text-pine-700">
              {formatPaise(cheapest.sellingPricePaise)}
            </span>
          </>
        )}
        . Listed cheapest first.
      </p>

      {salt.description && (
        <p className="mt-2 max-w-prose text-sm text-ink-700">
          {salt.description}
        </p>
      )}

      <p className="mt-4 max-w-prose rounded-[var(--radius-control)] bg-paper-sunk p-3 text-xs leading-relaxed text-ink-500">
        Products on this page share an active ingredient but may differ in
        strength, dosage form and inactive ingredients. Check with your doctor
        or our pharmacist before switching between them.
      </p>

      <div className="mt-6">
        <ProductGrid products={products} />
      </div>
    </div>
  );
}
