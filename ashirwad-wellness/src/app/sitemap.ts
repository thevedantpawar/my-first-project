import type { MetadataRoute } from "next";

import { db } from "@/lib/db";
import { siteUrl } from "@/lib/seo";

/**
 * Products, categories and salt listings. Only active products appear — a
 * delisted medicine must not be reachable from a search engine either.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const [products, categories, salts] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
    }),
    db.category.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
    }),
    db.salt.findMany({ select: { slug: true, updatedAt: true } }),
  ]);

  return [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    ...categories.map((c) => ({
      url: `${base}/category/${c.slug}`,
      lastModified: c.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...products.map((p) => ({
      url: `${base}/product/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...salts.map((s) => ({
      url: `${base}/salt/${s.slug}`,
      lastModified: s.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
