import "server-only";
import { db } from "./db";
import { PRODUCT_CARD_SELECT, type ProductCardData } from "./catalogue";

/**
 * Catalogue search.
 *
 * Two behaviours matter here and both are load-bearing for a pharmacy:
 *
 *  1. **Salt-based results.** Searching "paracetamol" must surface every brand
 *     containing it — Crocin, Dolo, Calpol — not just products with the word in
 *     their name. Customers arrive knowing either the brand their doctor wrote
 *     or the molecule, and the catalogue has to answer both.
 *
 *  2. **Typo tolerance.** "azithromicin", "pantaprazole" and "cetrizine" are
 *     how these are actually typed. Trigram similarity handles them; exact
 *     substring matching does not.
 *
 * Ranking deliberately puts an exact name match above a high-similarity fuzzy
 * match, so typing a brand exactly never buries it under a near-miss.
 */

/** Below this, a trigram match is noise rather than a near-miss. */
const SIMILARITY_FLOOR = 0.22;

/** A score at or above this means the query found what it was looking for. */
const STRONG_MATCH = 0.55;

/**
 * When a strong match exists, weaker results must clear this fraction of the
 * best score to survive.
 */
const RELATIVE_CUTOFF = 0.6;

type ScoredRow = { id: string; score: number; name_hit: boolean };

/**
 * Drops the weak fuzzy tail when confident matches exist.
 *
 * Drug names are deliberately similar — cefixime and cefpodoxime differ by a
 * few trigrams, as do most of a cephalosporin family. Without this, searching
 * "cefixime" returns three cefixime products *and* a cefpodoxime one, which in
 * a pharmacy is worse than an empty result: a customer scanning a result list
 * should not have to notice that the fourth item is a different molecule.
 *
 * When nothing scores well the tail is kept, because then the near-misses are
 * the whole point — that is what makes "azithromicin" find Azithral.
 */
function dropWeakTail(rows: ScoredRow[]): ScoredRow[] {
  const best = rows.reduce((max, r) => Math.max(max, r.score), 0);
  if (best < STRONG_MATCH) return rows;

  const cutoff = best * RELATIVE_CUTOFF;
  return rows.filter((r) => r.name_hit || r.score >= cutoff);
}

async function scoreProducts(query: string, limit: number): Promise<ScoredRow[]> {
  const rows = await db.$queryRaw<ScoredRow[]>`
    WITH scored AS (
      SELECT
        p."id",
        GREATEST(
          similarity(p."name", ${query}),
          similarity(p."composition", ${query}) * 0.90,
          COALESCE(similarity(b."name", ${query}), 0) * 0.85,
          COALESCE(MAX(similarity(s."name", ${query})), 0) * 0.95
        ) AS score,
        (
          p."name" ILIKE ${"%" + query + "%"}
          OR p."composition" ILIKE ${"%" + query + "%"}
          OR b."name" ILIKE ${"%" + query + "%"}
          OR BOOL_OR(s."name" ILIKE ${"%" + query + "%"})
        ) AS name_hit
      FROM "products" p
      LEFT JOIN "brands" b ON b."id" = p."brandId"
      LEFT JOIN "product_salts" ps ON ps."productId" = p."id"
      LEFT JOIN "salts" s ON s."id" = ps."saltId"
      WHERE p."isActive" = true
      GROUP BY p."id", b."name"
    )
    SELECT "id", score, name_hit
    FROM scored
    WHERE score >= ${SIMILARITY_FLOOR} OR name_hit
    ORDER BY name_hit DESC, score DESC
    LIMIT ${limit}
  `;

  return dropWeakTail(rows);
}

/** Full search results, ordered by relevance. */
export async function searchProducts(
  rawQuery: string,
  limit = 48,
): Promise<ProductCardData[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const scored = await scoreProducts(query, limit);
  if (scored.length === 0) return [];

  const products = await db.product.findMany({
    where: { id: { in: scored.map((r) => r.id) } },
    select: PRODUCT_CARD_SELECT,
  });

  // findMany loses the relevance ordering, so reapply it.
  const byId = new Map(products.map((p) => [p.id, p]));
  return scored
    .map((r) => byId.get(r.id))
    .filter((p): p is ProductCardData => !!p);
}

export type Suggestion =
  | { kind: "product"; label: string; sublabel: string; slug: string; requiresPrescription: boolean }
  | { kind: "salt"; label: string; sublabel: string; slug: string }
  | { kind: "brand"; label: string; sublabel: string; slug: string };

/**
 * Autocomplete across products, salts and brands.
 *
 * Salt and brand suggestions come first when they match well — they are
 * broader queries, and a customer typing "amlodipine" usually wants the salt
 * listing rather than whichever brand happens to rank first.
 */
export async function suggest(rawQuery: string, limit = 8): Promise<Suggestion[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const like = `%${query}%`;

  const [salts, brands, scored] = await Promise.all([
    db.$queryRaw<{ name: string; slug: string; count: bigint }[]>`
      SELECT s."name", s."slug", COUNT(ps."productId") AS count
      FROM "salts" s
      JOIN "product_salts" ps ON ps."saltId" = s."id"
      JOIN "products" p ON p."id" = ps."productId" AND p."isActive" = true
      WHERE s."name" ILIKE ${like} OR similarity(s."name", ${query}) >= ${SIMILARITY_FLOOR}
      GROUP BY s."id", s."name", s."slug"
      ORDER BY (s."name" ILIKE ${like}) DESC, similarity(s."name", ${query}) DESC
      LIMIT 3
    `,
    db.$queryRaw<{ name: string; slug: string; count: bigint }[]>`
      SELECT b."name", b."slug", COUNT(p."id") AS count
      FROM "brands" b
      JOIN "products" p ON p."brandId" = b."id" AND p."isActive" = true
      WHERE b."name" ILIKE ${like} OR similarity(b."name", ${query}) >= ${SIMILARITY_FLOOR}
      GROUP BY b."id", b."name", b."slug"
      ORDER BY (b."name" ILIKE ${like}) DESC, similarity(b."name", ${query}) DESC
      LIMIT 2
    `,
    scoreProducts(query, limit),
  ]);

  const suggestions: Suggestion[] = [];

  for (const s of salts) {
    suggestions.push({
      kind: "salt",
      label: s.name,
      sublabel: `${Number(s.count)} ${Number(s.count) === 1 ? "medicine" : "medicines"}`,
      slug: s.slug,
    });
  }

  for (const b of brands) {
    suggestions.push({
      kind: "brand",
      label: b.name,
      sublabel: `${Number(b.count)} ${Number(b.count) === 1 ? "product" : "products"}`,
      slug: b.slug,
    });
  }

  const remaining = Math.max(0, limit - suggestions.length);
  if (remaining > 0 && scored.length > 0) {
    const products = await db.product.findMany({
      where: { id: { in: scored.slice(0, remaining).map((r) => r.id) } },
      select: {
        name: true,
        slug: true,
        composition: true,
        requiresPrescription: true,
        id: true,
      },
    });

    const byId = new Map(products.map((p) => [p.id, p]));
    for (const row of scored.slice(0, remaining)) {
      const p = byId.get(row.id);
      if (!p) continue;
      suggestions.push({
        kind: "product",
        label: p.name,
        sublabel: p.composition,
        slug: p.slug,
        requiresPrescription: p.requiresPrescription,
      });
    }
  }

  return suggestions.slice(0, limit);
}

/** All products containing a given salt — the target of a salt suggestion. */
export async function getProductsBySalt(saltSlug: string) {
  const salt = await db.salt.findUnique({
    where: { slug: saltSlug },
    select: { id: true, name: true, description: true },
  });
  if (!salt) return null;

  const products = await db.product.findMany({
    where: { isActive: true, salts: { some: { saltId: salt.id } } },
    select: PRODUCT_CARD_SELECT,
    orderBy: { sellingPricePaise: "asc" },
  });

  return { salt, products };
}
