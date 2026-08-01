import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { db } from "@/lib/db";
import {
  findRxGateViolations,
  assertRxGate,
  RxGateError,
  getUsablePrescriptions,
  type GateLine,
} from "@/lib/rx-gate";
import {
  PrescriptionStatus,
  OrderStatus,
  PaymentMethod,
  ScheduleType,
  Role,
} from "@/generated/prisma/enums";

/**
 * Rx gate bypass attempts.
 *
 * These call the enforcement path directly — no browser, no form, no client
 * validation in the way — because that is exactly what an attacker does. A
 * Server Action is a public HTTP endpoint; anything that only holds because
 * the UI hides a button is not a control.
 *
 * Fixtures are created against the real database and torn down afterwards.
 */

const SUFFIX = `gate-${Date.now()}`;
let customerId: string;
let otherCustomerId: string;
let addressId: string;
let otcProductId: string;
let rxProductId: string;
let h1ProductId: string;

const createdOrderIds: string[] = [];
const createdPrescriptionIds: string[] = [];

async function makePrescription(overrides: {
  userId?: string;
  status?: PrescriptionStatus;
  validUntil?: Date | null;
  refillsAllowed?: number;
}) {
  const p = await db.prescription.create({
    data: {
      userId: overrides.userId ?? customerId,
      imageKey: `prescriptions/${SUFFIX}-${Math.random().toString(36).slice(2)}.jpg`,
      status: overrides.status ?? PrescriptionStatus.VERIFIED,
      validUntil:
        overrides.validUntil === undefined
          ? new Date(Date.now() + 30 * 24 * 3600 * 1000)
          : overrides.validUntil,
      refillsAllowed: overrides.refillsAllowed ?? 0,
    },
    select: { id: true },
  });
  createdPrescriptionIds.push(p.id);
  return p.id;
}

/** Creates a real order consuming a prescription, to exercise refill limits. */
async function makeOrderConsuming(prescriptionId: string, productId: string) {
  const product = await db.product.findUniqueOrThrow({
    where: { id: productId },
    include: { manufacturer: true },
  });

  const order = await db.order.create({
    data: {
      orderNumber: `TEST-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
      userId: customerId,
      addressId,
      status: OrderStatus.CONFIRMED,
      paymentMethod: PaymentMethod.COD,
      subtotalPaise: product.sellingPricePaise,
      totalPaise: product.sellingPricePaise,
      shipAddressSnapshot: {},
      items: {
        create: {
          productId: product.id,
          quantity: 1,
          nameSnapshot: product.name,
          compositionSnapshot: product.composition,
          packSizeSnapshot: product.packSize,
          manufacturerSnapshot: product.manufacturer.name,
          scheduleTypeSnapshot: product.scheduleType,
          hsnCodeSnapshot: product.hsnCode,
          gstRateBpsSnapshot: product.gstRateBps,
          mrpPaise: product.mrpPaise,
          sellingPricePaise: product.sellingPricePaise,
          lineTotalPaise: product.sellingPricePaise,
          lineGstPaise: 0,
          prescriptionId,
        },
      },
    },
    select: { id: true },
  });
  createdOrderIds.push(order.id);
  return order.id;
}

beforeAll(async () => {
  const [customer, other] = await Promise.all([
    db.user.create({
      data: { email: `gate-${SUFFIX}@example.invalid`, role: Role.CUSTOMER },
      select: { id: true },
    }),
    db.user.create({
      data: { email: `gate-other-${SUFFIX}@example.invalid`, role: Role.CUSTOMER },
      select: { id: true },
    }),
  ]);
  customerId = customer.id;
  otherCustomerId = other.id;

  const address = await db.address.create({
    data: {
      userId: customerId,
      fullName: "Gate Test",
      phone: "9876543210",
      line1: "1 Test Road",
      city: "Nashik",
      state: "Maharashtra",
      pincode: "422001",
    },
    select: { id: true },
  });
  addressId = address.id;

  const [otc, rx, h1] = await Promise.all([
    db.product.findFirstOrThrow({
      where: { scheduleType: ScheduleType.OTC, isActive: true },
      select: { id: true },
    }),
    db.product.findFirstOrThrow({
      where: { scheduleType: ScheduleType.SCHEDULE_H, isActive: true },
      select: { id: true },
    }),
    db.product.findFirstOrThrow({
      where: { scheduleType: ScheduleType.SCHEDULE_H1, isActive: true },
      select: { id: true },
    }),
  ]);
  otcProductId = otc.id;
  rxProductId = rx.id;
  h1ProductId = h1.id;
});

afterAll(async () => {
  await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await db.orderStatusEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await db.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await db.cartItem.deleteMany({ where: { cart: { userId: customerId } } });
  await db.cart.deleteMany({ where: { userId: { in: [customerId, otherCustomerId] } } });
  await db.prescription.deleteMany({ where: { id: { in: createdPrescriptionIds } } });
  await db.address.deleteMany({ where: { userId: customerId } });
  await db.user.deleteMany({ where: { id: { in: [customerId, otherCustomerId] } } });
  await db.$disconnect();
});

describe("Rx gate — what it lets through", () => {
  it("allows an OTC-only order with no prescription at all", async () => {
    const lines: GateLine[] = [
      { productId: otcProductId, quantity: 2, prescriptionId: null },
    ];
    expect(await findRxGateViolations(db, customerId, lines)).toEqual([]);
  });

  it("allows a Schedule H line with a verified, in-date prescription", async () => {
    const prescriptionId = await makePrescription({});
    const lines: GateLine[] = [{ productId: rxProductId, quantity: 1, prescriptionId }];
    expect(await findRxGateViolations(db, customerId, lines)).toEqual([]);
  });
});

describe("Rx gate — bypass attempts", () => {
  it("REFUSES a Schedule H line with no prescription attached", async () => {
    const lines: GateLine[] = [
      { productId: rxProductId, quantity: 1, prescriptionId: null },
    ];
    const violations = await findRxGateViolations(db, customerId, lines);

    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe("NO_PRESCRIPTION_LINKED");
    await expect(assertRxGate(db, customerId, lines)).rejects.toThrow(RxGateError);
  });

  it("REFUSES a Schedule H1 line with no prescription attached", async () => {
    const lines: GateLine[] = [
      { productId: h1ProductId, quantity: 1, prescriptionId: null },
    ];
    await expect(assertRxGate(db, customerId, lines)).rejects.toThrow(RxGateError);
  });

  it("REFUSES an unverified prescription, however it was uploaded", async () => {
    for (const status of [
      PrescriptionStatus.UPLOADED,
      PrescriptionStatus.UNDER_REVIEW,
      PrescriptionStatus.REJECTED,
      PrescriptionStatus.CLARIFICATION_REQUESTED,
      PrescriptionStatus.EXPIRED,
    ]) {
      const prescriptionId = await makePrescription({ status });
      const lines: GateLine[] = [
        { productId: rxProductId, quantity: 1, prescriptionId },
      ];
      const violations = await findRxGateViolations(db, customerId, lines);

      expect(violations, `status ${status} should be refused`).toHaveLength(1);
      expect(violations[0].reason).toBe("PRESCRIPTION_NOT_VERIFIED");
    }
  });

  it("REFUSES someone else's verified prescription", async () => {
    // The realistic attack: a valid, genuinely verified prescription id that
    // simply belongs to a different account.
    const prescriptionId = await makePrescription({
      userId: otherCustomerId,
      status: PrescriptionStatus.VERIFIED,
    });

    const lines: GateLine[] = [{ productId: rxProductId, quantity: 1, prescriptionId }];
    const violations = await findRxGateViolations(db, customerId, lines);

    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe("PRESCRIPTION_NOT_OWNED");
  });

  it("REFUSES a fabricated prescription id", async () => {
    const lines: GateLine[] = [
      { productId: rxProductId, quantity: 1, prescriptionId: "clzzzzzzzzzzzzzzzzzzzzzz" },
    ];
    const violations = await findRxGateViolations(db, customerId, lines);
    expect(violations[0].reason).toBe("PRESCRIPTION_NOT_OWNED");
  });

  it("REFUSES an expired prescription", async () => {
    const prescriptionId = await makePrescription({
      validUntil: new Date(Date.now() - 24 * 3600 * 1000),
    });
    const lines: GateLine[] = [{ productId: rxProductId, quantity: 1, prescriptionId }];
    const violations = await findRxGateViolations(db, customerId, lines);

    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe("PRESCRIPTION_EXPIRED");
  });

  it("REFUSES a prescription whose repeats are exhausted", async () => {
    // refillsAllowed = 0 means one supply only.
    const prescriptionId = await makePrescription({ refillsAllowed: 0 });
    const lines: GateLine[] = [{ productId: rxProductId, quantity: 1, prescriptionId }];

    expect(await findRxGateViolations(db, customerId, lines)).toEqual([]);

    await makeOrderConsuming(prescriptionId, rxProductId);

    const after = await findRxGateViolations(db, customerId, lines);
    expect(after).toHaveLength(1);
    expect(after[0].reason).toBe("PRESCRIPTION_EXHAUSTED");
  });

  it("permits exactly refillsAllowed + 1 supplies, no more", async () => {
    const prescriptionId = await makePrescription({ refillsAllowed: 2 });
    const lines: GateLine[] = [{ productId: rxProductId, quantity: 1, prescriptionId }];

    for (let supply = 1; supply <= 3; supply++) {
      expect(
        await findRxGateViolations(db, customerId, lines),
        `supply ${supply} of 3 should be allowed`,
      ).toEqual([]);
      await makeOrderConsuming(prescriptionId, rxProductId);
    }

    const fourth = await findRxGateViolations(db, customerId, lines);
    expect(fourth[0]?.reason).toBe("PRESCRIPTION_EXHAUSTED");
  });

  it("does not let a cancelled order consume a repeat", async () => {
    const prescriptionId = await makePrescription({ refillsAllowed: 0 });
    const orderId = await makeOrderConsuming(prescriptionId, rxProductId);

    const lines: GateLine[] = [{ productId: rxProductId, quantity: 1, prescriptionId }];
    expect((await findRxGateViolations(db, customerId, lines))[0]?.reason).toBe(
      "PRESCRIPTION_EXHAUSTED",
    );

    await db.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });

    // A cancelled order dispensed nothing, so the supply must be released.
    expect(await findRxGateViolations(db, customerId, lines)).toEqual([]);
  });

  it("REFUSES a mixed cart when only the OTC line is covered", async () => {
    const prescriptionId = await makePrescription({});
    const lines: GateLine[] = [
      { productId: otcProductId, quantity: 1, prescriptionId },
      { productId: rxProductId, quantity: 1, prescriptionId: null },
    ];

    const violations = await findRxGateViolations(db, customerId, lines);
    expect(violations).toHaveLength(1);
    expect(violations[0].productId).toBe(rxProductId);
  });

  it("reports every uncovered line, not just the first", async () => {
    const lines: GateLine[] = [
      { productId: rxProductId, quantity: 1, prescriptionId: null },
      { productId: h1ProductId, quantity: 1, prescriptionId: null },
    ];
    expect(await findRxGateViolations(db, customerId, lines)).toHaveLength(2);
  });

  it("REFUSES a product that no longer exists", async () => {
    const lines: GateLine[] = [
      { productId: "clnonexistentproductid00", quantity: 1, prescriptionId: null },
    ];
    expect(await findRxGateViolations(db, customerId, lines)).toHaveLength(1);
  });
});

describe("Rx gate — the picker cannot offer what the gate would refuse", () => {
  it("excludes unverified, expired and exhausted prescriptions", async () => {
    const usableId = await makePrescription({ refillsAllowed: 1 });
    const unverifiedId = await makePrescription({
      status: PrescriptionStatus.UPLOADED,
    });
    const expiredId = await makePrescription({
      validUntil: new Date(Date.now() - 1000),
    });
    const exhaustedId = await makePrescription({ refillsAllowed: 0 });
    await makeOrderConsuming(exhaustedId, rxProductId);

    const usable = await getUsablePrescriptions(customerId);
    const ids = usable.map((p) => p.id);

    expect(ids).toContain(usableId);
    expect(ids).not.toContain(unverifiedId);
    expect(ids).not.toContain(expiredId);
    expect(ids).not.toContain(exhaustedId);
  });

  it("never offers another customer's prescription", async () => {
    const foreignId = await makePrescription({ userId: otherCustomerId });
    const usable = await getUsablePrescriptions(customerId);
    expect(usable.map((p) => p.id)).not.toContain(foreignId);
  });
});
