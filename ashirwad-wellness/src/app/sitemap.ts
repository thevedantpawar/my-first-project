import type { MetadataRoute } from "next";

import { db } from "@/lib/db";
import { siteUrl } from "@/lib/seo";

/**
 * Generated per request rather than prerendered.
 *
 * Two reasons, and the second is the important one. A catalogue changes — a
 * delisted medicine has to leave the sitemap when it is delisted, not at the
 * next deploy. And prerendering this made the *production build* require a
 * live database, which a container build in CI does not have: the image build
 * failed at `next build` with P1001 rather than at run time.
 */
export const dynamic = "force-dynamic";

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
