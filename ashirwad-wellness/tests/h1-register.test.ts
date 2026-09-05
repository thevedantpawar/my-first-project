import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

import { db } from "@/lib/db";
import {
  PrescriptionStatus,
  OrderStatus,
  PaymentMethod,
  ScheduleType,
  Role,
} from "@/generated/prisma/enums";

/**
 * Schedule H1 register — Rule 65(11A).
 *
 * These exercise the real pharmacist actions, with only the framework seams
 * stubbed (session and cache revalidation). The register logic, the
 * transaction boundary and the database constraints are all genuine.
 */

const SUFFIX = `h1-${Date.now()}`;

let pharmacistId: string;
let customerId: string;
let addressId: string;
let h1ProductId: string;

// The session seam. requirePharmacist normally re-reads the role and
// registration number from the database on every call; here it is pinned to a
// real pharmacist row created in beforeAll.
vi.mock("@/auth", () => ({
  requirePharmacist: async () => ({
    id: pharmacistId,
    name: "Test Pharmacist",
    email: `pharm-${SUFFIX}@example.invalid`,
    role: Role.PHARMACIST,
    isActive: true,
    pharmacistRegNo: "MSPC-TEST-0001",
  }),
  requireUser: async () => ({ id: customerId, role: Role.CUSTOMER }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { approveOrder, rejectOrder, fileH1Correction } = await import(
  "@/actions/pharmacist"
);

const createdOrderIds: string[] = [];
const createdPrescriptionIds: string[] = [];

async function makeVerifiedPrescription() {
  const p = await db.prescription.create({
    data: {
      userId: customerId,
      imageKey: `prescriptions/${SUFFIX}-${Math.random().toString(36).slice(2)}.jpg`,
      status: PrescriptionStatus.VERIFIED,
      verifiedById: pharmacistId,
      verifiedAt: new Date(),
      doctorName: "Dr R Kulkarni",
      doctorRegNo: "MMC-2011-44821",
      validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      refillsAllowed: 1,
    },
    select: { id: true },
  });
  createdPrescriptionIds.push(p.id);
  return p.id;
}

async function makePendingH1Order(prescriptionId: string) {
  const product = await db.product.findUniqueOrThrow({
    where: { id: h1ProductId },
    include: { manufacturer: true },
  });

  const order = await db.order.create({
    data: {
      orderNumber: `H1TEST-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
      userId: customerId,
      addressId,
      status: OrderStatus.PENDING_PHARMACIST_REVIEW,
      paymentMethod: PaymentMethod.COD,
      containsRxItems: true,
      containsH1Items: true,
      subtotalPaise: product.sellingPricePaise * 2,
      totalPaise: product.sellingPricePaise * 2,
      shipAddressSnapshot: {},
      items: {
        create: {
          productId: product.id,
          quantity: 2,
          nameSnapshot: product.name,
          compositionSnapshot: product.composition,
          strengthSnapshot: product.strength,
          packSizeSnapshot: product.packSize,
          manufacturerSnapshot: product.manufacturer.name,
          scheduleTypeSnapshot: product.scheduleType,
          hsnCodeSnapshot: product.hsnCode,
          gstRateBpsSnapshot: product.gstRateBps,
          mrpPaise: product.mrpPaise,
          sellingPricePaise: product.sellingPricePaise,
          lineTotalPaise: product.sellingPricePaise * 2,
          lineGstPaise: 0,
          prescriptionId,
        },
      },
    },
    include: { items: true },
  });
  createdOrderIds.push(order.id);
  return order;
}

beforeAll(async () => {
  const pharmacist = await db.user.create({
    data: {
      email: `pharm-${SUFFIX}@example.invalid`,
      name: "Test Pharmacist",
      role: Role.PHARMACIST,
      pharmacistRegNo: "MSPC-TEST-0001",
    },
    select: { id: true },
  });
  pharmacistId = pharmacist.id;

  const customer = await db.user.create({
    data: { email: `cust-${SUFFIX}@example.invalid`, name: "Sunita Deshmukh" },
    select: { id: true },
  });
  customerId = customer.id;

  const address = await db.address.create({
    data: {
      userId: customerId,
      fullName: "Sunita Deshmukh",
      phone: "9876543210",
      line1: "1 Test Road",
      city: "Nashik",
      state: "Maharashtra",
      pincode: "422001",
    },
    select: { id: true },
  });
  addressId = address.id;

  const h1 = await db.product.findFirstOrThrow({
    where: { scheduleType: ScheduleType.SCHEDULE_H1, isActive: true },
    select: { id: true },
  });
  h1ProductId = h1.id;
});

afterAll(async () => {
  // Register rows cannot be deleted, and they hold a foreign key to the order
  // item they dispensed — so an order that reached the register cannot be
  // torn down either. That is the register pinning its own evidence, and it is
  // correct: these tests therefore clean up only the orders that never got
  // that far, and run under their own throwaway pharmacist.
  const registered = await db.scheduleH1Register.findMany({
    where: { orderId: { in: createdOrderIds } },
    select: { orderId: true },
  });
  const pinned = new Set(registered.map((r) => r.orderId));
  const removable = createdOrderIds.filter((id) => !pinned.has(id));

  await db.orderItem.deleteMany({ where: { orderId: { in: removable } } });
  await db.orderStatusEvent.deleteMany({ where: { orderId: { in: removable } } });
  await db.order.deleteMany({ where: { id: { in: removable } } });
  await db.$disconnect();
});

describe("approving an order writes the H1 register", () => {
  it("creates one entry per Schedule H1 line, with snapshotted detail", async () => {
    const prescriptionId = await makeVerifiedPrescription();
    const order = await makePendingH1Order(prescriptionId);

    const result = await approveOrder({
      orderId: order.id,
      h1Batches: [
        {
          orderItemId: order.items[0].id,
          batchNumber: "ZFX2481",
          expiryDate: "2027-11-30",
        },
      ],
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);

    const entries = await db.scheduleH1Register.findMany({
      where: { orderId: order.id },
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];

    // Prescriber, patient, drug, quantity, batch, expiry and the dispensing
    // pharmacist — everything Rule 65(11A) asks a register to record.
    expect(entry.prescriberName).toBe("Dr R Kulkarni");
    expect(entry.prescriberRegNo).toBe("MMC-2011-44821");
    expect(entry.patientName).toBe("Sunita Deshmukh");
    expect(entry.quantity).toBe(2);
    expect(entry.batchNumber).toBe("ZFX2481");
    expect(entry.pharmacistRegNo).toBe("MSPC-TEST-0001");
    expect(entry.serialNo).toBeGreaterThan(0);
    expect(entry.correctsEntryId).toBeNull();

    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe(OrderStatus.CONFIRMED);

    // Batch and expiry are written back to the order line so the invoice and
    // the register cannot disagree.
    const item = await db.orderItem.findUniqueOrThrow({
      where: { id: order.items[0].id },
    });
    expect(item.batchNumber).toBe("ZFX2481");

    // The register entry is audited.
    const auditRow = await db.auditLog.findFirst({
      where: {
        action: "H1_REGISTER_ENTRY_CREATED",
        entityId: entry.id,
      },
    });
    expect(auditRow).not.toBeNull();
  });

  it("refuses to approve an H1 order without batch and expiry", async () => {
    const prescriptionId = await makeVerifiedPrescription();
    const order = await makePendingH1Order(prescriptionId);

    const result = await approveOrder({ orderId: order.id, h1Batches: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/batch number and expiry/i);

    // Nothing partial: no register entry, order still pending.
    expect(await db.scheduleH1Register.count({ where: { orderId: order.id } })).toBe(0);
    const unchanged = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.status).toBe(OrderStatus.PENDING_PHARMACIST_REVIEW);
  });

  it("refuses to approve when the prescription is no longer verified", async () => {
    const prescriptionId = await makeVerifiedPrescription();
    const order = await makePendingH1Order(prescriptionId);

    // The gate passed at checkout; the pharmacist rejected it afterwards.
    await db.prescription.update({
      where: { id: prescriptionId },
      data: { status: PrescriptionStatus.REJECTED, rejectionReason: "Illegible" },
    });

    const result = await approveOrder({
      orderId: order.id,
      h1Batches: [
        { orderItemId: order.items[0].id, batchNumber: "X1", expiryDate: "2027-01-31" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(await db.scheduleH1Register.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("refuses to approve an order that is not awaiting review", async () => {
    const prescriptionId = await makeVerifiedPrescription();
    const order = await makePendingH1Order(prescriptionId);

    await db.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.DELIVERED },
    });

    const result = await approveOrder({
      orderId: order.id,
      h1Batches: [
        { orderItemId: order.items[0].id, batchNumber: "X2", expiryDate: "2027-01-31" },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe("the register is a register", () => {
  it("refuses UPDATE and DELETE through the ORM, not just raw SQL", async () => {
    const entry = await db.scheduleH1Register.findFirstOrThrow({
      where: { pharmacistId },
    });

    await expect(
      db.scheduleH1Register.update({
        where: { id: entry.id },
        data: { quantity: 999 },
      }),
    ).rejects.toThrow();

    await expect(
      db.scheduleH1Register.delete({ where: { id: entry.id } }),
    ).rejects.toThrow();
  });

  it("permits only one original entry per dispensed item", async () => {
    const entry = await db.scheduleH1Register.findFirstOrThrow({
      where: { pharmacistId, correctsEntryId: null },
    });

    await expect(
      db.scheduleH1Register.create({
        data: {
          orderId: entry.orderId,
          orderItemId: entry.orderItemId,
          prescriptionId: entry.prescriptionId,
          prescriberName: "Duplicate",
          prescriberRegNo: "X",
          patientName: "Duplicate",
          drugName: entry.drugName,
          composition: entry.composition,
          form: entry.form,
          packSize: entry.packSize,
          quantity: 1,
          pharmacistId,
          pharmacistName: "Test Pharmacist",
          pharmacistRegNo: "MSPC-TEST-0001",
        },
      }),
    ).rejects.toThrow();
  });

  it("corrects by insertion, leaving the original byte-for-byte intact", async () => {
    const original = await db.scheduleH1Register.findFirstOrThrow({
      where: { pharmacistId, correctsEntryId: null },
    });

    const result = await fileH1Correction({
      correctsEntryId: original.id,
      reason: "Quantity mis-keyed at dispensing; pack count re-checked against the strip.",
      quantity: 1,
      batchNumber: original.batchNumber ?? "ZFX2481",
      expiryDate: "2027-11-30",
      prescriberName: original.prescriberName,
      prescriberRegNo: original.prescriberRegNo,
      patientName: original.patientName,
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);

    const correction = await db.scheduleH1Register.findFirstOrThrow({
      where: { correctsEntryId: original.id },
    });
    expect(correction.quantity).toBe(1);
    expect(correction.correctionReason).toMatch(/mis-keyed/);
    expect(correction.serialNo).toBeGreaterThan(original.serialNo);

    // The original is unchanged.
    const reread = await db.scheduleH1Register.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(reread.quantity).toBe(original.quantity);
    expect(reread.batchNumber).toBe(original.batchNumber);
  });

  it("refuses a second correction against the same entry", async () => {
    const original = await db.scheduleH1Register.findFirstOrThrow({
      where: { pharmacistId, correctsEntryId: null },
    });

    const result = await fileH1Correction({
      correctsEntryId: original.id,
      reason: "Attempting to correct an already-corrected entry.",
      quantity: 5,
      batchNumber: "ZZZ",
      expiryDate: "2027-11-30",
      prescriberName: original.prescriberName,
      prescriberRegNo: original.prescriberRegNo,
      patientName: original.patientName,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already been corrected/i);
  });

  it("requires a stated reason for a correction", async () => {
    const original = await db.scheduleH1Register.findFirstOrThrow({
      where: { pharmacistId },
    });

    const result = await fileH1Correction({
      correctsEntryId: original.id,
      reason: "typo",
      quantity: 1,
      batchNumber: "X",
      expiryDate: "2027-01-31",
      prescriberName: "A",
      prescriberRegNo: "B",
      patientName: "C",
    });
    expect(result.ok).toBe(false);
  });
});

describe("rejecting an order", () => {
  it("writes no register entry and returns the stock", async () => {
    const prescriptionId = await makeVerifiedPrescription();
    const order = await makePendingH1Order(prescriptionId);

    const before = await db.product.findUniqueOrThrow({
      where: { id: h1ProductId },
      select: { stock: true },
    });

    const result = await rejectOrder({
      orderId: order.id,
      reason: "Prescription does not cover the quantity requested.",
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await db.scheduleH1Register.count({ where: { orderId: order.id } })).toBe(0);

    const after = await db.product.findUniqueOrThrow({
      where: { id: h1ProductId },
      select: { stock: true },
    });
    expect(after.stock).toBe(before.stock + 2);

    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe(OrderStatus.PHARMACIST_REJECTED);
    expect(updated.reviewRejectionReason).toMatch(/does not cover/i);
  });

  it("requires a reason", async () => {
    const prescriptionId = await makeVerifiedPrescription();
    const order = await makePendingH1Order(prescriptionId);

    const result = await rejectOrder({ orderId: order.id, reason: "no" });
    expect(result.ok).toBe(false);
  });
});
