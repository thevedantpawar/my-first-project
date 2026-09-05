import { describe, it, expect, afterAll } from "vitest";

import { db } from "@/lib/db";
import {
  computeTotals,
  priceLines,
  availablePaymentMethods,
  isCodAllowed,
} from "@/lib/pricing";
import { policy } from "@/lib/pharmacy";
import { ScheduleType, PaymentMethod } from "@/generated/prisma/enums";

afterAll(async () => {
  await db.$disconnect();
});

const otc = {
  id: "p-otc",
  name: "Crocin Advance 500mg Tablet",
  scheduleType: ScheduleType.OTC,
  requiresPrescription: false,
  mrpPaise: 3100,
  sellingPricePaise: 2790,
  gstRateBps: 1200,
};

const rx = {
  id: "p-rx",
  name: "Zifi 200 Tablet",
  scheduleType: ScheduleType.SCHEDULE_H1,
  requiresPrescription: true,
  mrpPaise: 17800,
  sellingPricePaise: 15200,
  gstRateBps: 1200,
};

describe("line pricing", () => {
  it("keeps every figure an integer number of paise", () => {
    const [line] = priceLines([{ quantity: 3, product: otc }]);

    expect(line.lineTotalPaise).toBe(8370);
    expect(Number.isInteger(line.lineTotalPaise)).toBe(true);
    expect(Number.isInteger(line.lineGstPaise)).toBe(true);
    expect(Number.isInteger(line.savingsPaise)).toBe(true);
  });

  it("derives requiresPrescription from scheduleType, not from the input flag", () => {
    // A caller lying about the flag must not change the outcome.
    const [line] = priceLines([
      { quantity: 1, product: { ...rx, requiresPrescription: false } },
    ]);
    expect(line.requiresPrescription).toBe(true);
  });

  it("extracts GST from an inclusive price rather than adding it", () => {
    const [line] = priceLines([{ quantity: 1, product: { ...otc, sellingPricePaise: 11200 } }]);
    // ₹112 inclusive of 12% -> ₹12 tax, and the line total is unchanged.
    expect(line.lineGstPaise).toBe(1200);
    expect(line.lineTotalPaise).toBe(11200);
  });
});

describe("COD ceiling", () => {
  it("allows COD at and below the ceiling", () => {
    expect(isCodAllowed(policy.codCeilingPaise)).toBe(true);
    expect(isCodAllowed(policy.codCeilingPaise - 1)).toBe(true);
  });

  it("refuses COD above the ceiling", () => {
    expect(isCodAllowed(policy.codCeilingPaise + 1)).toBe(false);

    const options = availablePaymentMethods(policy.codCeilingPaise + 1);
    const cod = options.find((o) => o.method === PaymentMethod.COD);
    expect(cod?.available).toBe(false);
    expect(cod?.reason).toMatch(/cash on delivery/i);
  });
});

describe("coupons", () => {
  const CODE = `TESTCOUP${Date.now()}`;
  let userId: string;
  let couponId: string;

  it("excludes prescription items from a coupon that does not opt in", async () => {
    const user = await db.user.create({
      data: { email: `coupon-${Date.now()}@example.invalid` },
      select: { id: true },
    });
    userId = user.id;

    const coupon = await db.coupon.create({
      data: {
        code: CODE,
        percentOff: 50,
        minOrderPaise: 0,
        perUserLimit: 5,
        appliesToRxItems: false,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
      select: { id: true },
    });
    couponId = coupon.id;

    const totals = await computeTotals(
      [
        { quantity: 1, product: otc }, // ₹27.90
        { quantity: 1, product: rx }, // ₹152.00 — must not be discounted
      ],
      { userId, couponCode: CODE },
    );

    // 50% of the OTC line only.
    expect(totals.discountPaise).toBe(1395);
    expect(totals.subtotalPaise).toBe(17990);
  });

  it("refuses a coupon when the cart is prescription-only", async () => {
    const totals = await computeTotals([{ quantity: 1, product: rx }], {
      userId,
      couponCode: CODE,
    });

    expect(totals.coupon).toBeNull();
    expect(totals.couponError).toBe("NO_ELIGIBLE_ITEMS");
    expect(totals.discountPaise).toBe(0);
  });

  it("reports an unknown code rather than silently ignoring it", async () => {
    const totals = await computeTotals([{ quantity: 1, product: otc }], {
      userId,
      couponCode: "NOPE-DOES-NOT-EXIST",
    });
    expect(totals.couponError).toBe("NOT_FOUND");
  });

  it("never discounts more than the eligible subtotal", async () => {
    const flatCode = `FLAT${Date.now()}`;
    await db.coupon.create({
      data: {
        code: flatCode,
        flatOffPaise: 1_000_000,
        minOrderPaise: 0,
        perUserLimit: 5,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });

    const totals = await computeTotals([{ quantity: 1, product: otc }], {
      userId,
      couponCode: flatCode,
    });

    expect(totals.discountPaise).toBe(otc.sellingPricePaise);
    expect(totals.totalPaise).toBeGreaterThanOrEqual(0);

    await db.coupon.delete({ where: { code: flatCode } });
  });

  it("flags H1 content on the totals so the order can be routed", async () => {
    const totals = await computeTotals([{ quantity: 1, product: rx }], { userId });
    expect(totals.containsRxItems).toBe(true);
    expect(totals.containsH1Items).toBe(true);

    const otcOnly = await computeTotals([{ quantity: 1, product: otc }], { userId });
    expect(otcOnly.containsRxItems).toBe(false);
    expect(otcOnly.containsH1Items).toBe(false);
  });

  afterAll(async () => {
    await db.coupon.deleteMany({ where: { id: couponId } });
    await db.user.deleteMany({ where: { id: userId } });
  });
});
