import { z } from "zod";

import { DosageForm } from "@/generated/prisma/enums";
import type { CatalogueFilters, SortKey } from "./catalogue";

/**
 * Parses catalogue URL parameters into filters.
 *
 * Validated rather than trusted: these values come from the address bar, so an
 * unparseable `maxPrice` or an invented `form` is dropped rather than passed
 * through to a query. Zod's `catch` keeps a malformed URL from 500-ing a
 * catalogue page — a bad filter should degrade to no filter.
 */

const sortSchema = z
  .enum(["relevance", "price-asc", "price-desc", "discount", "name"])
  .catch("relevance");

const paiseSchema = z.coerce.number().int().min(0).max(100_000_000);

export type RawSearchParams = Record<string, string | string[] | undefined>;

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseCatalogueParams(
  params: RawSearchParams,
  categorySlug?: string,
): CatalogueFilters {
  const forms = asArray(params.form).filter(
    (f): f is DosageForm => f in DosageForm,
  );

  const maxPrice = paiseSchema.safeParse(params.maxPrice);
  const minDiscount = z.coerce
    .number()
    .int()
    .min(0)
    .max(100)
    .safeParse(params.minDiscount);
  const page = z.coerce.number().int().min(1).max(1000).safeParse(params.page);

  const rxRaw = typeof params.rx === "string" ? params.rx : undefined;

  return {
    categorySlug,
    brandSlugs: asArray(params.brand),
    forms,
    requiresPrescription:
      rxRaw === "true" ? true : rxRaw === "false" ? false : undefined,
    maxPricePaise: maxPrice.success ? maxPrice.data : undefined,
    minDiscountPercent: minDiscount.success ? minDiscount.data : undefined,
    sort: sortSchema.parse(params.sort) as SortKey,
    page: page.success ? page.data : 1,
  };
}

export function parseQuery(params: RawSearchParams): string {
  const q = typeof params.q === "string" ? params.q : "";
  return q.trim().slice(0, 64);
}
