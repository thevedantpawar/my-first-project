import "server-only";
import { db } from "./db";
import { Prisma } from "@/generated/prisma/client";
import { DosageForm, ScheduleType } from "@/generated/prisma/enums";

/**
 * Catalogue query layer.
 *
 * Every query here filters on `isActive`. A delisted product must not be
 * reachable from search, a category page, or a direct slug — delisting is a
 * compliance action, not a merchandising one.
 */

export type SortKey =
  | "relevance"
  | "price-asc"
  | "price-desc"
  | "discount"
  | "name";

export type CatalogueFilters = {
  categorySlug?: string;
  brandSlugs?: string[];
  forms?: DosageForm[];
  /** undefined = no filter, true = Rx only, false = non-Rx only. */
  requiresPrescription?: boolean;
  minPricePaise?: number;
  maxPricePaise?: number;
  /** Minimum discount percentage, e.g. 20 for "20% off or more". */
  minDiscountPercent?: number;
  inStockOnly?: boolean;
  sort?: SortKey;
  page?: number;
  perPage?: number;
};

export const PRODUCT_CARD_SELECT = {
  id: true,
  name: true,
  nameHi: true,
  slug: true,
  images: true,
  composition: true,
  strength: true,
  form: true,
  packSize: true,
  scheduleType: true,
  requiresPrescription: true,
  mrpPaise: true,
  sellingPricePaise: true,
  stock: true,
  isRefrigerated: true,
  brand: { select: { name: true, slug: true } },
  manufacturer: { select: { name: true } },
} satisfies Prisma.ProductSelect;

export type ProductCardData = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_CARD_SELECT;
}>;

/** Descendant category ids, so "Medicines" includes every subcategory. */
async function categoryIdsFor(slug: string): Promise<string[]> {
  const category = await db.category.findUnique({
    where: { slug },
    select: { id: true, children: { select: { id: true } } },
  });
  if (!category) return [];
  return [category.id, ...category.children.map((c) => c.id)];
}

function buildWhere(
  filters: CatalogueFilters,
  categoryIds: string[],
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { isActive: true };

  if (categoryIds.length > 0) where.categoryId = { in: categoryIds };

  if (filters.brandSlugs?.length) {
    where.brand = { slug: { in: filters.brandSlugs } };
  }

  if (filters.forms?.length) where.form = { in: filters.forms };

  if (filters.requiresPrescription !== undefined) {
    where.requiresPrescription = filters.requiresPrescription;
  }

  if (filters.inStockOnly) where.stock = { gt: 0 };

  if (
    filters.minPricePaise !== undefined ||
    filters.maxPricePaise !== undefined
  ) {
    where.sellingPricePaise = {
      ...(filters.minPricePaise !== undefined
        ? { gte: filters.minPricePaise }
        : {}),
      ...(filters.maxPricePaise !== undefined
        ? { lte: filters.maxPricePaise }
        : {}),
    };
  }

  return where;
}

function orderBy(sort: SortKey = "relevance"): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "price-asc":
      return [{ sellingPricePaise: "asc" }, { name: "asc" }];
    case "price-desc":
      return [{ sellingPricePaise: "desc" }, { name: "asc" }];
    case "name":
      return [{ name: "asc" }];
    case "discount":
      // Prisma cannot order by a computed expression, so discount sorting is
      // applied in memory after the page is fetched. See listProducts.
      return [{ name: "asc" }];
    default:
      return [{ stock: "desc" }, { name: "asc" }];
  }
}

export async function listProducts(filters: CatalogueFilters) {
  const perPage = filters.perPage ?? 24;
  const page = Math.max(1, filters.page ?? 1);

  const categoryIds = filters.categorySlug
    ? await categoryIdsFor(filters.categorySlug)
    : [];

  // A category slug that matches nothing must return nothing, not everything.
  if (filters.categorySlug && categoryIds.length === 0) {
    return { products: [], total: 0, page, perPage, totalPages: 0 };
  }

  const where = buildWhere(filters, categoryIds);

  const discountSort =
    filters.sort === "discount" || filters.minDiscountPercent !== undefined;

  // Discount is (mrp - selling) / mrp, which Prisma cannot express in a filter
  // or an ORDER BY. When it is needed, fetch the matching set and compute it
  // here. The catalogue is small enough that this is cheaper than a raw query
  // duplicating the filter logic.
  if (discountSort) {
    const all = await db.product.findMany({
      where,
      select: PRODUCT_CARD_SELECT,
    });

    const withDiscount = all
      .map((p) => ({
        product: p,
        discount:
          p.mrpPaise > 0
            ? Math.round(((p.mrpPaise - p.sellingPricePaise) / p.mrpPaise) * 100)
            : 0,
      }))
      .filter(
        (x) =>
          filters.minDiscountPercent === undefined ||
          x.discount >= filters.minDiscountPercent,
      );

    if (filters.sort === "discount") {
      withDiscount.sort((a, b) => b.discount - a.discount);
    } else {
      withDiscount.sort((a, b) => a.product.name.localeCompare(b.product.name));
    }

    const total = withDiscount.length;
    const products = withDiscount
      .slice((page - 1) * perPage, page * perPage)
      .map((x) => x.product);

    return { products, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  }

  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      select: PRODUCT_CARD_SELECT,
      orderBy: orderBy(filters.sort),
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    db.product.count({ where }),
  ]);

  return { products, total, page, perPage, totalPages: Math.ceil(total / perPage) };
}

/** Facet values for the filter rail, scoped to the current category. */
export async function getFilterFacets(categorySlug?: string) {
  const categoryIds = categorySlug ? await categoryIdsFor(categorySlug) : [];
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    ...(categoryIds.length ? { categoryId: { in: categoryIds } } : {}),
  };

  const [products, brands] = await Promise.all([
    db.product.findMany({
      where,
      select: {
        form: true,
        sellingPricePaise: true,
        requiresPrescription: true,
        brandId: true,
      },
    }),
    db.brand.findMany({
      where: { isActive: true, products: { some: where } },
      select: { name: true, slug: true, _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const formCounts = new Map<DosageForm, number>();
  for (const p of products) {
    formCounts.set(p.form, (formCounts.get(p.form) ?? 0) + 1);
  }

  const prices = products.map((p) => p.sellingPricePaise);

  return {
    brands,
    forms: [...formCounts.entries()]
      .map(([form, count]) => ({ form, count }))
      .sort((a, b) => b.count - a.count),
    rxCount: products.filter((p) => p.requiresPrescription).length,
    nonRxCount: products.filter((p) => !p.requiresPrescription).length,
    minPricePaise: prices.length ? Math.min(...prices) : 0,
    maxPricePaise: prices.length ? Math.max(...prices) : 0,
    total: products.length,
  };
}

export async function getProductBySlug(slug: string) {
  return db.product.findFirst({
    where: { slug, isActive: true },
    include: {
      brand: true,
      manufacturer: true,
      category: { include: { parent: true } },
      salts: { include: { salt: true } },
    },
  });
}

/**
 * Cheaper equivalents — the same salt composition at the same strength, from a
 * different brand.
 *
 * Matching is on `saltKey`, the normalised and sorted salt fingerprint, so a
 * combination drug only matches another product with the *same* combination.
 * Substituting a two-salt product with a single-salt one would be wrong and
 * this cannot do it.
 *
 * Schedule type must also match. A Schedule H drug is never presented as
 * substitutable by an OTC product, regardless of composition.
 */
export async function getSaltSubstitutes(product: {
  id: string;
  saltKey: string | null;
  scheduleType: ScheduleType;
  sellingPricePaise: number;
}) {
  if (!product.saltKey) return [];

  return db.product.findMany({
    where: {
      id: { not: product.id },
      saltKey: product.saltKey,
      scheduleType: product.scheduleType,
      isActive: true,
      stock: { gt: 0 },
    },
    select: PRODUCT_CARD_SELECT,
    orderBy: { sellingPricePaise: "asc" },
    take: 8,
  });
}

export async function getCategoryTree() {
  return db.category.findMany({
    where: { parentId: null, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      children: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { products: true } },
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  });
}

export async function getCategoryBySlug(slug: string) {
  return db.category.findUnique({
    where: { slug },
    include: { parent: true, children: { orderBy: { name: "asc" } } },
  });
}

/** Best current savings, for the home page offer rail. */
export async function getOfferRail(take = 12) {
  const products = await db.product.findMany({
    where: { isActive: true, stock: { gt: 0 } },
    select: PRODUCT_CARD_SELECT,
  });

  return products
    .map((p) => ({
      product: p,
      discount:
        p.mrpPaise > 0
          ? (p.mrpPaise - p.sellingPricePaise) / p.mrpPaise
          : 0,
    }))
    .sort((a, b) => b.discount - a.discount)
    .slice(0, take)
    .map((x) => x.product);
}

/**
 * Products the customer has previously received, for the reorder shortcut.
 * Only delivered orders count — reordering something still under pharmacist
 * review would be misleading.
 */
export async function getReorderSuggestions(userId: string, take = 8) {
  const items = await db.orderItem.findMany({
    where: { order: { userId, status: "DELIVERED" } },
    select: { productId: true, order: { select: { deliveredAt: true } } },
    orderBy: { order: { deliveredAt: "desc" } },
    take: 40,
  });

  const seen = new Set<string>();
  const productIds: string[] = [];
  for (const item of items) {
    if (!seen.has(item.productId)) {
      seen.add(item.productId);
      productIds.push(item.productId);
    }
    if (productIds.length >= take) break;
  }

  if (productIds.length === 0) return [];

  const products = await db.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    select: PRODUCT_CARD_SELECT,
  });

  // Preserve most-recently-delivered ordering, which the IN query loses.
  const byId = new Map(products.map((p) => [p.id, p]));
  return productIds.map((id) => byId.get(id)).filter((p): p is ProductCardData => !!p);
}
