import { describe, it, expect, afterAll } from "vitest";

import { searchProducts, suggest, getProductsBySalt } from "@/lib/search";
import { listProducts, getSaltSubstitutes, getFilterFacets } from "@/lib/catalogue";
import { db } from "@/lib/db";
import { ScheduleType, DosageForm } from "@/generated/prisma/enums";

afterAll(async () => {
  await db.$disconnect();
});

describe("salt-based search", () => {
  it("surfaces every brand containing a salt, not just name matches", async () => {
    const results = await searchProducts("paracetamol");
    const names = results.map((p) => p.name);

    // Crocin and Dolo have "Paracetamol" in the composition, not the name.
    expect(names.some((n) => n.includes("Crocin"))).toBe(true);
    expect(names.some((n) => n.includes("Dolo"))).toBe(true);
    // Combiflam is a combination product that also contains it.
    expect(names.some((n) => n.includes("Combiflam"))).toBe(true);
  });

  it("finds a molecule that appears in no product name at all", async () => {
    const results = await searchProducts("cefixime");

    // Zifi, Taxim-O and Mahacef all contain cefixime; none has it in the name.
    // Which brand ranks first is not worth asserting — that every result
    // genuinely contains the molecule is.
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(
      results.every((p) => p.composition.toLowerCase().includes("cefixime")),
      `got: ${results.map((p) => `${p.name} (${p.composition})`).join("; ")}`,
    ).toBe(true);
    expect(results.every((p) => !p.name.toLowerCase().includes("cefixime"))).toBe(true);
  });

  it("does not mix a different molecule in beside exact matches", async () => {
    // Cefixime and cefpodoxime are a few trigrams apart. Returning Monocef-O
    // (cefpodoxime) in a "cefixime" search is worse than returning nothing —
    // a customer scanning the list should not have to spot that one result is
    // a different drug.
    const results = await searchProducts("cefixime");
    expect(results.some((p) => p.name.includes("Monocef"))).toBe(false);
  });

  it("still keeps the fuzzy tail when nothing matches strongly", async () => {
    // The weak-tail cut must not defeat typo tolerance: with no strong match,
    // near-misses are the entire value of the search.
    const results = await searchProducts("cefpodoxim");
    expect(results.some((p) => p.name.includes("Monocef"))).toBe(true);
  });
});

describe("typo tolerance", () => {
  const typos: [string, string][] = [
    ["azithromicin", "Azithral"],
    ["cetrizine", "Cetzine"],
    ["pantaprazole", "Pan 40"],
    ["telmisartin", "Telma"],
    ["amoxycillin", "Mox"],
  ];

  for (const [typo, expected] of typos) {
    it(`"${typo}" still finds ${expected}`, async () => {
      const results = await searchProducts(typo, 12);
      expect(
        results.some((p) => p.name.includes(expected)),
        `expected a result containing "${expected}", got: ${results.map((p) => p.name).join(", ") || "(none)"}`,
      ).toBe(true);
    });
  }

  it("ranks an exact brand match first", async () => {
    const results = await searchProducts("Crocin");
    expect(results[0].name).toContain("Crocin");
  });

  it("returns nothing for a query with no plausible match", async () => {
    expect(await searchProducts("qqzzxwv")).toEqual([]);
  });

  it("ignores queries shorter than two characters", async () => {
    expect(await searchProducts("a")).toEqual([]);
  });
});

describe("autocomplete", () => {
  it("offers the salt above individual products", async () => {
    const s = await suggest("amlodipine");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].kind).toBe("salt");
    expect(s[0].label).toBe("Amlodipine");
  });

  it("flags prescription products in the suggestion payload", async () => {
    const s = await suggest("azithral");
    const product = s.find((x) => x.kind === "product");
    expect(product).toBeDefined();
    if (product?.kind === "product") {
      expect(product.requiresPrescription).toBe(true);
    }
  });
});

describe("salt substitutes", () => {
  // The original version of this suite only asserted that no *wrong*
  // substitute appears, which passes vacuously when the catalogue contains no
  // substitutable products at all — and it did. These two tests assert the
  // feature actually fires.
  it("finds real substitutes for a product that has them", async () => {
    const crocin = await db.product.findFirstOrThrow({
      where: { slug: "crocin-advance-500mg-tablet" },
      select: { id: true, saltKey: true, scheduleType: true, sellingPricePaise: true },
    });

    const subs = await getSaltSubstitutes(crocin);
    expect(subs.length).toBeGreaterThan(0);
    // At least one must actually be cheaper, or the panel has no point.
    expect(subs.some((s) => s.sellingPricePaise < crocin.sellingPricePaise)).toBe(true);
  });

  it("keeps at least one substitutable group in the catalogue", async () => {
    const groups = await db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM (
        SELECT "saltKey" FROM "products"
        WHERE "saltKey" IS NOT NULL AND "isActive" = true
        GROUP BY "saltKey" HAVING COUNT(*) > 1
      ) g
    `;
    expect(Number(groups[0].count)).toBeGreaterThan(0);
  });

  it("offers cheaper same-salt equivalents", async () => {
    const dolo = await db.product.findFirstOrThrow({
      where: { slug: "dolo-650mg-tablet" },
      select: { id: true, saltKey: true, scheduleType: true, sellingPricePaise: true },
    });

    // Dolo is Paracetamol 650mg; Crocin is 500mg. Different strength means a
    // different saltKey, so they must NOT be offered as substitutes.
    const subs = await getSaltSubstitutes(dolo);
    expect(subs.every((s) => !s.name.includes("Crocin"))).toBe(true);
  });

  it("never substitutes across schedule types", async () => {
    const products = await db.product.findMany({
      where: { requiresPrescription: true, saltKey: { not: null } },
      select: { id: true, saltKey: true, scheduleType: true, sellingPricePaise: true },
      take: 10,
    });

    for (const p of products) {
      const subs = await getSaltSubstitutes(p);
      for (const s of subs) {
        expect(s.scheduleType).toBe(p.scheduleType);
      }
    }
  });

  it("returns nothing when the product has no salt fingerprint", async () => {
    expect(
      await getSaltSubstitutes({
        id: "x",
        saltKey: null,
        scheduleType: ScheduleType.COSMETIC,
        sellingPricePaise: 100,
      }),
    ).toEqual([]);
  });
});

describe("catalogue filters", () => {
  it("filters to prescription-only products", async () => {
    const { products } = await listProducts({ requiresPrescription: true, perPage: 100 });
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.requiresPrescription)).toBe(true);
  });

  it("filters to non-prescription products", async () => {
    const { products } = await listProducts({ requiresPrescription: false, perPage: 100 });
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => !p.requiresPrescription)).toBe(true);
  });

  it("includes subcategory products when filtering by a parent category", async () => {
    const { total } = await listProducts({ categorySlug: "medicines", perPage: 100 });
    expect(total).toBeGreaterThan(20);
  });

  it("returns nothing for an unknown category rather than everything", async () => {
    const { products, total } = await listProducts({ categorySlug: "no-such-category" });
    expect(products).toEqual([]);
    expect(total).toBe(0);
  });

  it("respects a price ceiling", async () => {
    const { products } = await listProducts({ maxPricePaise: 5000, perPage: 100 });
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.sellingPricePaise <= 5000)).toBe(true);
  });

  it("sorts by price ascending", async () => {
    const { products } = await listProducts({ sort: "price-asc", perPage: 20 });
    const prices = products.map((p) => p.sellingPricePaise);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("sorts by discount descending", async () => {
    const { products } = await listProducts({ sort: "discount", perPage: 10 });
    const discounts = products.map((p) =>
      Math.round(((p.mrpPaise - p.sellingPricePaise) / p.mrpPaise) * 100),
    );
    expect([...discounts].sort((a, b) => b - a)).toEqual(discounts);
  });

  it("filters by dosage form", async () => {
    const { products } = await listProducts({ forms: [DosageForm.SYRUP], perPage: 50 });
    expect(products.every((p) => p.form === DosageForm.SYRUP)).toBe(true);
  });

  it("builds facets scoped to the category", async () => {
    const facets = await getFilterFacets("medicines");
    expect(facets.total).toBeGreaterThan(0);
    expect(facets.brands.length).toBeGreaterThan(0);
    expect(facets.rxCount + facets.nonRxCount).toBe(facets.total);
    expect(facets.minPricePaise).toBeLessThanOrEqual(facets.maxPricePaise);
  });
});

describe("salt listing page", () => {
  it("lists every product containing the salt, cheapest first", async () => {
    const result = await getProductsBySalt("paracetamol");
    expect(result).not.toBeNull();
    expect(result!.products.length).toBeGreaterThan(2);

    const prices = result!.products.map((p) => p.sellingPricePaise);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("returns null for an unknown salt", async () => {
    expect(await getProductsBySalt("not-a-salt")).toBeNull();
  });
});
