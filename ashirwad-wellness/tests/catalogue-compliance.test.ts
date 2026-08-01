import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

import { PrismaClient } from "@/generated/prisma/client";
import { ScheduleType } from "@/generated/prisma/enums";
import { lintProductClaims } from "@/lib/claims";
import { requiresPrescription } from "@/lib/schedule";

/**
 * Tests the seeded catalogue itself, not just the library functions.
 *
 * A claim linter nobody runs over the actual product copy is decoration. This
 * asserts that every claim-restricted product in the live catalogue passes,
 * so seed data cannot drift into non-compliance unnoticed.
 */

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

beforeAll(async () => {
  const count = await db.product.count();
  if (count === 0) {
    throw new Error("Catalogue is empty — run `npm run db:seed` before these tests.");
  }
});

afterAll(async () => {
  await db.$disconnect();
});

describe("seeded catalogue", () => {
  it("has no therapeutic claims in nutraceutical, cosmetic or ayurvedic copy", async () => {
    const products = await db.product.findMany({
      where: {
        scheduleType: {
          in: [
            ScheduleType.NUTRACEUTICAL,
            ScheduleType.COSMETIC,
            ScheduleType.AYURVEDIC,
          ],
        },
      },
    });

    expect(products.length).toBeGreaterThan(0);

    const offenders = products.flatMap((p) =>
      lintProductClaims(p).map((v) => `${p.name} → ${v.field}: "${v.matched}" (${v.reason})`),
    );

    expect(offenders).toEqual([]);
  });

  it("has requiresPrescription consistent with scheduleType for every product", async () => {
    const products = await db.product.findMany({
      select: { name: true, scheduleType: true, requiresPrescription: true },
    });

    const drifted = products.filter(
      (p) => p.requiresPrescription !== requiresPrescription(p.scheduleType),
    );

    expect(drifted).toEqual([]);
  });

  it("lists no banned substance anywhere in the catalogue", async () => {
    const [products, banned] = await Promise.all([
      db.product.findMany({ select: { name: true, composition: true } }),
      db.bannedSubstance.findMany({ select: { name: true } }),
    ]);

    expect(banned.length).toBeGreaterThan(0);

    const hits = products.flatMap((p) => {
      const haystack = `${p.name} ${p.composition}`.toLowerCase();
      return banned
        .filter((b) => haystack.includes(b.name.toLowerCase()))
        .map((b) => `${p.name} contains banned substance "${b.name}"`);
    });

    expect(hits).toEqual([]);
  });

  it("never prices a product above its MRP, and keeps money integral", async () => {
    const products = await db.product.findMany({
      select: { name: true, mrpPaise: true, sellingPricePaise: true },
    });

    const bad = products.filter(
      (p) =>
        p.sellingPricePaise > p.mrpPaise ||
        !Number.isInteger(p.mrpPaise) ||
        !Number.isInteger(p.sellingPricePaise),
    );

    expect(bad).toEqual([]);
  });

  it("has at least one Schedule H1 product so the register path is testable", async () => {
    const h1 = await db.product.count({
      where: { scheduleType: ScheduleType.SCHEDULE_H1 },
    });
    expect(h1).toBeGreaterThan(0);
  });

  it("assigns a salt fingerprint to every prescription medicine", async () => {
    // Substitute lookup is a core Phase 2 feature and depends on saltKey.
    const missing = await db.product.findMany({
      where: { requiresPrescription: true, saltKey: null },
      select: { name: true },
    });
    expect(missing).toEqual([]);
  });
});

describe("database-level enforcement", () => {
  it("rejects a Schedule H product that claims it needs no prescription", async () => {
    const category = await db.category.findFirstOrThrow();
    const manufacturer = await db.manufacturer.findFirstOrThrow();

    await expect(
      db.product.create({
        data: {
          name: "Bypass Attempt Tablet",
          slug: `bypass-attempt-${Date.now()}`,
          categoryId: category.id,
          manufacturerId: manufacturer.id,
          scheduleType: ScheduleType.SCHEDULE_H,
          // The lie the whole constraint exists to catch.
          requiresPrescription: false,
          composition: "Amoxicillin 500mg",
          form: "TABLET",
          packSize: "strip of 10",
          hsnCode: "30041020",
          gstRateBps: 1200,
          mrpPaise: 10000,
          sellingPricePaise: 9000,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects listing a banned substance under an innocuous schedule type", async () => {
    const category = await db.category.findFirstOrThrow();
    const manufacturer = await db.manufacturer.findFirstOrThrow();

    await expect(
      db.product.create({
        data: {
          name: "Fortwin Injection",
          slug: `fortwin-${Date.now()}`,
          categoryId: category.id,
          manufacturerId: manufacturer.id,
          scheduleType: ScheduleType.OTC,
          requiresPrescription: false,
          composition: "Pentazocine 30mg/ml",
          form: "INJECTION",
          packSize: "1 ml ampoule",
          hsnCode: "30049099",
          gstRateBps: 1200,
          mrpPaise: 5000,
          sellingPricePaise: 4500,
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses to rewrite an audit log entry", async () => {
    const entry = await db.auditLog.create({
      data: {
        action: "PRESCRIPTION_VIEWED",
        entityType: "Test",
        entityId: "append-only-check",
      },
    });

    await expect(
      db.auditLog.update({
        where: { id: entry.id },
        data: { entityType: "Tampered" },
      }),
    ).rejects.toThrow();

    await expect(
      db.auditLog.delete({ where: { id: entry.id } }),
    ).rejects.toThrow();
  });
});
