import type { Metadata } from "next";
import Link from "next/link";

import { searchProducts } from "@/lib/search";
import { listProducts } from "@/lib/catalogue";
import { parseCatalogueParams, parseQuery, type RawSearchParams } from "@/lib/search-params";
import { ProductGrid } from "@/components/product-card";
import { SearchBox } from "@/components/search-box";

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseQuery(await searchParams);
  return {
    title: q ? `Search: ${q}` : "Search",
    // Search result pages are thin and near-duplicative; keeping them out of
    // the index protects the crawl budget for category and product pages.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const rawParams = await searchParams;
  const q = parseQuery(rawParams);

  // With no query this becomes a browse-everything view, which is what the
  // "See all savings" link on the home page needs.
  const products = q
    ? await searchProducts(q)
    : (await listProducts({ ...parseCatalogueParams(rawParams), perPage: 48 })).products;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <SearchBox initialQuery={q} autoFocus={!q} />
      </div>

      <div className="mt-6">
        {q ? (
          <h1 className="text-lg text-ink">
            <span className="identifier">{products.length}</span>{" "}
            {products.length === 1 ? "result" : "results"} for{" "}
            <span className="text-pine-700">&ldquo;{q}&rdquo;</span>
          </h1>
        ) : (
          <h1 className="text-lg text-ink">Browse the catalogue</h1>
        )}
      </div>

      {products.length > 0 ? (
        <div className="mt-4">
          <ProductGrid products={products} />
        </div>
      ) : (
        <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-ink-100 p-10 text-center">
          <p className="text-sm text-ink-700">
            Nothing matched &ldquo;{q}&rdquo;.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Try the salt name — searching{" "}
            <span className="identifier">paracetamol</span> finds every brand
            containing it.
          </p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm text-living-600 hover:underline"
          >
            Back to home
          </Link>
        </div>
      )}
    </div>
  );
}
