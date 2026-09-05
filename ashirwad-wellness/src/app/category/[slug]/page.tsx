import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

import {
  getCategoryBySlug,
  getFilterFacets,
  listProducts,
} from "@/lib/catalogue";
import { parseCatalogueParams, type RawSearchParams } from "@/lib/search-params";
import { ProductGrid } from "@/components/product-card";
import { CatalogueFilters } from "@/components/catalogue-filters";
import { CataloguePagination } from "@/components/catalogue-pagination";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "Category not found" };

  return {
    title: category.name,
    description:
      category.description ??
      `Buy ${category.name.toLowerCase()} online from Ashirwad Wellness, a licensed pharmacy in Nashik.`,
    // Filters and pagination live in the query string; the canonical points at
    // the unfiltered page so filtered permutations do not compete with it.
    alternates: { canonical: `/category/${slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const rawParams = await searchParams;

  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const filters = parseCatalogueParams(rawParams, slug);

  const [{ products, total, page, totalPages }, facets] = await Promise.all([
    listProducts(filters),
    getFilterFacets(slug),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
        <Link href="/" className="hover:text-living-600">
          Home
        </Link>
        {category.parent && (
          <>
            <span aria-hidden="true"> / </span>
            <Link
              href={`/category/${category.parent.slug}`}
              className="hover:text-living-600"
            >
              {category.parent.name}
            </Link>
          </>
        )}
        <span aria-hidden="true"> / </span>
        <span className="text-ink-700">{category.name}</span>
      </nav>

      <h1 className="mt-2 text-2xl text-ink sm:text-3xl">{category.name}</h1>
      <p className="mt-1 text-sm text-ink-500">
        <span className="identifier">{total}</span>{" "}
        {total === 1 ? "product" : "products"}
      </p>

      {category.children.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {category.children.map((child) => (
            <Link
              key={child.id}
              href={`/category/${child.slug}`}
              className="rounded-full border border-ink-100 bg-paper-raised px-3 py-1.5 text-sm text-ink-700 hover:border-living-500 hover:text-living-600"
            >
              {child.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 gap-8 lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="mb-6 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4 lg:mb-0 lg:sticky lg:top-32 lg:self-start">
          <h2 className="sr-only">Filter products</h2>
          <CatalogueFilters facets={facets} />
        </aside>

        <div className="min-w-0">
          {products.length > 0 ? (
            <>
              <ProductGrid products={products} />
              <CataloguePagination
                page={page}
                totalPages={totalPages}
                baseHref={`/category/${slug}`}
                searchParams={rawParams}
              />
            </>
          ) : (
            <div className="rounded-[var(--radius-card)] border border-dashed border-ink-100 p-10 text-center">
              <p className="text-sm text-ink-700">
                No products match these filters.
              </p>
              <Link
                href={`/category/${slug}`}
                className="mt-2 inline-block text-sm text-living-600 hover:underline"
              >
                Clear all filters
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
