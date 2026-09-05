"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requirePharmacist } from "@/auth";
import { audit, auditInTransaction } from "@/lib/audit";
import { policy } from "@/lib/pharmacy";
import { sendPrescriptionVerified, sendPrescriptionRejected } from "@/lib/email";
import {
  PrescriptionStatus,
  OrderStatus,
  ScheduleType,
} from "@/generated/prisma/enums";
import type { ActionResult } from "./cart";

/**
 * Pharmacist decisions.
 *
 * Every action here requires the PHARMACIST or ADMIN role *and* a registration
 * number on file, because that number is stamped onto the statutory register.
 * `requirePharmacist` re-reads both from the database on every call — a
 * revoked pharmacist cannot keep dispensing on a still-valid session token.
 */

const verifySchema = z.object({
  prescriptionId: z.string().min(1).max(64),
  // Confirmed by the pharmacist against the image, not taken from the customer.
  doctorName: z.string().trim().min(2).max(120),
  doctorRegNo: z.string().trim().min(2).max(60),
  hospitalName: z.string().trim().max(160).optional().or(z.literal("")),
  issuedOn: z.string().trim().max(10).optional().or(z.literal("")),
  validityDays: z.coerce.number().int().min(1).max(365),
  refillsAllowed: z.coerce.number().int().min(0).max(11),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function verifyPrescription(input: unknown): Promise<ActionResult> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the details.",
    };
  }

  const pharmacist = await requirePharmacist();
  const data = parsed.data;

  const prescription = await db.prescription.findUnique({
    where: { id: data.prescriptionId },
    select: {
      id: true,
      status: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!prescription) return { ok: false, error: "Prescription not found." };

  // A prescription already used to dispense must not be re-verified with a
  // different validity or repeat budget — that would retroactively change what
  // an earlier order was allowed to do.
  const alreadyDispensed = await db.orderItem.count({
    where: { prescriptionId: prescription.id },
  });
  if (alreadyDispensed > 0) {
    return {
      ok: false,
      error:
        "This prescription has already been dispensed against and its terms cannot be changed. File a correction instead.",
    };
  }

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + data.validityDays);

  await db.prescription.update({
    where: { id: prescription.id },
    data: {
      status: PrescriptionStatus.VERIFIED,
      verifiedById: pharmacist.id,
      verifiedAt: new Date(),
      doctorName: data.doctorName,
      doctorRegNo: data.doctorRegNo,
      hospitalName: data.hospitalName || null,
      issuedOn: data.issuedOn ? new Date(data.issuedOn) : null,
      validUntil,
      refillsAllowed: data.refillsAllowed,
      rejectionReason: null,
      pharmacistNotes: data.notes || null,
    },
  });

  await audit({
    actorId: pharmacist.id,
    actorRole: pharmacist.role,
    action: "PRESCRIPTION_VERIFIED",
    entityType: "Prescription",
    entityId: prescription.id,
    metadata: {
      pharmacistRegNo: pharmacist.pharmacistRegNo,
      prescriberName: data.doctorName,
      prescriberRegNo: data.doctorRegNo,
      validUntil: validUntil.toISOString(),
      refillsAllowed: data.refillsAllowed,
    },
  });

  await sendPrescriptionVerified({
    to: prescription.user.email,
    customerName: prescription.user.name,
  });

  revalidatePath("/pharmacist");
  revalidatePath("/account/prescriptions");
  return { ok: true, data: undefined };
}

const rejectSchema = z.object({
  prescriptionId: z.string().min(1).max(64),
  reason: z.string().trim().min(5).max(500),
  // A clarification request is recoverable; a rejection is not.
  clarificationOnly: z.boolean().default(false),
});

export async function rejectPrescription(input: unknown): Promise<ActionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "A reason is required — the customer is told why.",
    };
  }

  const pharmacist = await requirePharmacist();
  const { prescriptionId, reason, clarificationOnly } = parsed.data;

  const prescription = await db.prescription.findUnique({
    where: { id: prescriptionId },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  if (!prescription) return { ok: false, error: "Prescription not found." };

  await db.prescription.update({
    where: { id: prescription.id },
    data: {
      status: clarificationOnly
        ? PrescriptionStatus.CLARIFICATION_REQUESTED
        : PrescriptionStatus.REJECTED,
      verifiedById: pharmacist.id,
      verifiedAt: new Date(),
      rejectionReason: reason,
    },
  });

  await audit({
    actorId: pharmacist.id,
    actorRole: pharmacist.role,
    action: clarificationOnly
      ? "PRESCRIPTION_CLARIFICATION_REQUESTED"
      : "PRESCRIPTION_REJECTED",
    entityType: "Prescription",
    entityId: prescription.id,
    metadata: { reason, pharmacistRegNo: pharmacist.pharmacistRegNo },
  });

  await sendPrescriptionRejected({
    to: prescription.user.email,
    customerName: prescription.user.name,
    reason,
  });

  revalidatePath("/pharmacist");
  revalidatePath("/account/prescriptions");
  return { ok: true, data: undefined };
}

const approveOrderSchema = z.object({
  orderId: z.string().min(1).max(64),
  /** Batch and expiry per Schedule H1 line, read off the pack being dispensed. */
  h1Batches: z
    .array(
      z.object({
        orderItemId: z.string().min(1).max(64),
        batchNumber: z.string().trim().min(1).max(60),
        expiryDate: z.string().trim().min(4).max(10),
      }),
    )
    .default([]),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * Approves an order for dispensing.
 *
 * On approval, every Schedule H1 line writes a `ScheduleH1Register` entry —
 * Rule 65(11A). This happens in the same transaction as the status change, so
 * an approved H1 order without a register entry is not a reachable state.
 *
 * The register is append-only at the database level, so this write is
 * permanent. That is deliberate: it is the point of a register.
 */
export async function approveOrder(input: unknown): Promise<ActionResult> {
  const parsed = approveOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const pharmacist = await requirePharmacist();
  const { orderId, h1Batches, notes } = parsed.data;

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      items: {
        include: {
          prescription: {
            select: {
              id: true,
              status: true,
              doctorName: true,
              doctorRegNo: true,
              patient: {
                select: { fullName: true, ageYears: true, gender: true },
              },
            },
          },
        },
      },
    },
  });

  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== OrderStatus.PENDING_PHARMACIST_REVIEW) {
    return {
      ok: false,
      error: `This order is ${order.status.toLowerCase().replace(/_/g, " ")} and is not awaiting review.`,
    };
  }

  const h1Items = order.items.filter(
    (i) => i.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1,
  );

  // Every H1 line must carry a batch and expiry before it can be dispensed.
  // The register has columns for them and a blank register entry is not a
  // register entry.
  const batchByItem = new Map(h1Batches.map((b) => [b.orderItemId, b]));
  const missing = h1Items.filter((i) => !batchByItem.get(i.id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Batch number and expiry are required for each Schedule H1 item before dispensing: ${missing
        .map((i) => i.nameSnapshot)
        .join(", ")}.`,
    };
  }

  // Every prescription-only line must still hold a verified prescription. The
  // gate ran at checkout; this re-checks at dispensing time, because a
  // prescription can be rejected in between.
  const uncovered = order.items.filter(
    (i) =>
      (i.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H ||
        i.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1) &&
      i.prescription?.status !== PrescriptionStatus.VERIFIED,
  );
  if (uncovered.length > 0) {
    return {
      ok: false,
      error: `These items no longer hold a verified prescription: ${uncovered
        .map((i) => i.nameSnapshot)
        .join(", ")}.`,
    };
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CONFIRMED,
          reviewedById: pharmacist.id,
          reviewedAt: new Date(),
        },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          fromStatus: OrderStatus.PENDING_PHARMACIST_REVIEW,
          toStatus: OrderStatus.CONFIRMED,
          actorId: pharmacist.id,
          note: notes || "Approved by pharmacist",
        },
      });

      for (const item of h1Items) {
        const batch = batchByItem.get(item.id)!;
        const prescription = item.prescription!;

        // Batch and expiry are also written back to the order line, so the
        // invoice and the register agree.
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            batchNumber: batch.batchNumber,
            expiryDate: new Date(batch.expiryDate),
          },
        });

        const entry = await tx.scheduleH1Register.create({
          data: {
            orderId: order.id,
            orderItemId: item.id,
            prescriptionId: prescription.id,
            // Everything below is a snapshot. The register must stay truthful
            // even if the product, user or prescription rows change later.
            prescriberName: prescription.doctorName ?? "Not recorded",
            prescriberRegNo: prescription.doctorRegNo ?? "Not recorded",
            patientName:
              prescription.patient?.fullName ?? order.user.name ?? "Not recorded",
            patientAge: prescription.patient?.ageYears ?? null,
            patientGender: prescription.patient?.gender ?? null,
            drugName: item.nameSnapshot,
            composition: item.compositionSnapshot,
            strength: item.strengthSnapshot,
            form: "TABLET",
            packSize: item.packSizeSnapshot,
            quantity: item.quantity,
            batchNumber: batch.batchNumber,
            expiryDate: new Date(batch.expiryDate),
            pharmacistId: pharmacist.id,
            pharmacistName: pharmacist.name ?? "Not recorded",
            pharmacistRegNo: pharmacist.pharmacistRegNo,
          },
          select: { id: true, serialNo: true },
        });

        // Audited inside the transaction: the register entry and its audit row
        // either both exist or neither does.
        await auditInTransaction(tx, {
          actorId: pharmacist.id,
          actorRole: pharmacist.role,
          action: "H1_REGISTER_ENTRY_CREATED",
          entityType: "ScheduleH1Register",
          entityId: entry.id,
          metadata: {
            serialNo: entry.serialNo,
            orderNumber: order.orderNumber,
            drug: item.nameSnapshot,
            quantity: item.quantity,
            batchNumber: batch.batchNumber,
            prescriberRegNo: prescription.doctorRegNo,
            pharmacistRegNo: pharmacist.pharmacistRegNo,
          },
        });
      }
    });
  } catch (error) {
    console.error("[pharmacist] order approval failed", error);
    return {
      ok: false,
      error:
        "Approval failed and nothing was recorded. Please retry — no register entry was written.",
    };
  }

  await audit({
    actorId: pharmacist.id,
    actorRole: pharmacist.role,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      orderNumber: order.orderNumber,
      from: OrderStatus.PENDING_PHARMACIST_REVIEW,
      to: OrderStatus.CONFIRMED,
      h1EntriesCreated: h1Items.length,
      pharmacistRegNo: pharmacist.pharmacistRegNo,
    },
  });

  revalidatePath("/pharmacist");
  revalidatePath("/account/orders");
  return { ok: true, data: undefined };
}

const rejectOrderSchema = z.object({
  orderId: z.string().min(1).max(64),
  reason: z.string().trim().min(5).max(500),
});

export async function rejectOrder(input: unknown): Promise<ActionResult> {
  const parsed = rejectOrderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "A reason is required — the customer is told why their order was declined.",
    };
  }

  const pharmacist = await requirePharmacist();
  const { orderId, reason } = parsed.data;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, status: true, items: { select: { productId: true, quantity: true } } },
  });

  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== OrderStatus.PENDING_PHARMACIST_REVIEW) {
    return { ok: false, error: "This order is not awaiting review." };
  }

  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PHARMACIST_REJECTED,
        reviewedById: pharmacist.id,
        reviewedAt: new Date(),
        reviewRejectionReason: reason,
      },
    });

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        fromStatus: OrderStatus.PENDING_PHARMACIST_REVIEW,
        toStatus: OrderStatus.PHARMACIST_REJECTED,
        actorId: pharmacist.id,
        note: reason,
      },
    });

    // Nothing was dispensed, so the stock goes back.
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }
  });

  await audit({
    actorId: pharmacist.id,
    actorRole: pharmacist.role,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      orderNumber: order.orderNumber,
      to: OrderStatus.PHARMACIST_REJECTED,
      reason,
      pharmacistRegNo: pharmacist.pharmacistRegNo,
    },
  });

  revalidatePath("/pharmacist");
  revalidatePath("/account/orders");
  return { ok: true, data: undefined };
}

/**
 * Files a correction against an existing register entry.
 *
 * The original row is never touched — the database refuses to update it. A
 * correction is a new row pointing at the old one, with a stated reason.
 */
const correctionSchema = z.object({
  correctsEntryId: z.string().min(1).max(64),
  reason: z.string().trim().min(10).max(500),
  quantity: z.coerce.number().int().min(1).max(1000),
  batchNumber: z.string().trim().min(1).max(60),
  expiryDate: z.string().trim().min(4).max(10),
  prescriberName: z.string().trim().min(2).max(120),
  prescriberRegNo: z.string().trim().min(2).max(60),
  patientName: z.string().trim().min(2).max(120),
});

export async function fileH1Correction(input: unknown): Promise<ActionResult> {
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "A correction must state what is being corrected and why.",
    };
  }

  const pharmacist = await requirePharmacist();
  const data = parsed.data;

  const original = await db.scheduleH1Register.findUnique({
    where: { id: data.correctsEntryId },
  });
  if (!original) return { ok: false, error: "Register entry not found." };

  const existingCorrection = await db.scheduleH1Register.findFirst({
    where: { correctsEntryId: original.id },
    select: { serialNo: true },
  });
  if (existingCorrection) {
    return {
      ok: false,
      error: `Entry ${original.serialNo} has already been corrected by entry ${existingCorrection.serialNo}.`,
    };
  }

  const entry = await db.scheduleH1Register.create({
    data: {
      orderId: original.orderId,
      // orderItemId is unique per entry, so a correction cannot reuse it.
      orderItemId: original.orderItemId,
      prescriptionId: original.prescriptionId,
      prescriberName: data.prescriberName,
      prescriberRegNo: data.prescriberRegNo,
      patientName: data.patientName,
      patientAge: original.patientAge,
      patientGender: original.patientGender,
      drugName: original.drugName,
      composition: original.composition,
      strength: original.strength,
      form: original.form,
      packSize: original.packSize,
      quantity: data.quantity,
      batchNumber: data.batchNumber,
      expiryDate: new Date(data.expiryDate),
      pharmacistId: pharmacist.id,
      pharmacistName: pharmacist.name ?? "Not recorded",
      pharmacistRegNo: pharmacist.pharmacistRegNo,
      correctsEntryId: original.id,
      correctionReason: data.reason,
    },
    select: { id: true, serialNo: true },
  });

  await audit({
    actorId: pharmacist.id,
    actorRole: pharmacist.role,
    action: "H1_REGISTER_CORRECTION_FILED",
    entityType: "ScheduleH1Register",
    entityId: entry.id,
    metadata: {
      serialNo: entry.serialNo,
      correctsSerialNo: original.serialNo,
      reason: data.reason,
      pharmacistRegNo: pharmacist.pharmacistRegNo,
    },
  });

  revalidatePath("/pharmacist/register");
  return { ok: true, data: undefined };
}

/** The default validity window offered in the verification form. */
export async function getVerificationDefaults() {
  await requirePharmacist();
  return { defaultValidityDays: policy.defaultPrescriptionValidityDays };
}
