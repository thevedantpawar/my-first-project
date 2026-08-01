import "server-only";
import { db } from "./db";
import { PrescriptionStatus, OrderStatus, ScheduleType } from "@/generated/prisma/enums";

/**
 * Pharmacist verification queue.
 *
 * Two distinct pieces of work land here and they are deliberately separate:
 *
 *  1. **Prescription verification.** Is this a genuine, legible, in-date
 *     prescription from an identifiable prescriber? Produces VERIFIED /
 *     REJECTED / CLARIFICATION_REQUESTED, plus the validity window and repeat
 *     budget.
 *
 *  2. **Order review.** Does the verified prescription actually cover *these*
 *     drugs at *these* quantities? Only a pharmacist can answer that, which is
 *     why passing the Rx gate is not the end of the process.
 *
 * Schedule H1 items are flagged throughout, because approving one writes a
 * statutory register entry that can never be edited afterwards.
 */

export const QUEUE_PRESCRIPTION_SELECT = {
  id: true,
  status: true,
  imageKey: true,
  mimeType: true,
  uploadedAt: true,
  doctorName: true,
  doctorRegNo: true,
  hospitalName: true,
  issuedOn: true,
  validUntil: true,
  refillsAllowed: true,
  rejectionReason: true,
  pharmacistNotes: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
  patient: { select: { id: true, fullName: true, relation: true, ageYears: true, gender: true } },
  verifiedBy: { select: { name: true, pharmacistRegNo: true } },
  verifiedAt: true,
} as const;

/** Prescriptions waiting on a pharmacist, oldest first. */
export async function getPrescriptionQueue() {
  return db.prescription.findMany({
    where: {
      status: {
        in: [PrescriptionStatus.UPLOADED, PrescriptionStatus.UNDER_REVIEW],
      },
    },
    select: {
      ...QUEUE_PRESCRIPTION_SELECT,
      // The items this prescription has been attached to — the pharmacist
      // needs to see what it is being used for, not just the image.
      cartItems: {
        select: {
          quantity: true,
          product: {
            select: {
              name: true,
              composition: true,
              strength: true,
              packSize: true,
              scheduleType: true,
            },
          },
        },
      },
    },
    orderBy: { uploadedAt: "asc" },
  });
}

export async function getPrescriptionForReview(prescriptionId: string) {
  return db.prescription.findUnique({
    where: { id: prescriptionId },
    select: {
      ...QUEUE_PRESCRIPTION_SELECT,
      cartItems: {
        select: {
          id: true,
          quantity: true,
          product: {
            select: {
              id: true,
              name: true,
              composition: true,
              strength: true,
              packSize: true,
              form: true,
              scheduleType: true,
            },
          },
        },
      },
      orderItems: {
        select: {
          id: true,
          quantity: true,
          nameSnapshot: true,
          compositionSnapshot: true,
          scheduleTypeSnapshot: true,
          order: { select: { orderNumber: true, status: true } },
        },
      },
    },
  });
}

/** Orders held for pharmacist review, oldest first. */
export async function getOrderReviewQueue() {
  return db.order.findMany({
    where: { status: OrderStatus.PENDING_PHARMACIST_REVIEW },
    select: {
      id: true,
      orderNumber: true,
      placedAt: true,
      totalPaise: true,
      containsH1Items: true,
      user: { select: { name: true, email: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          nameSnapshot: true,
          scheduleTypeSnapshot: true,
        },
      },
    },
    orderBy: { placedAt: "asc" },
  });
}

export async function getOrderForReview(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      items: {
        include: {
          prescription: {
            select: {
              id: true,
              imageKey: true,
              status: true,
              doctorName: true,
              doctorRegNo: true,
              validUntil: true,
              refillsAllowed: true,
              patient: { select: { fullName: true, ageYears: true, gender: true } },
            },
          },
          product: {
            select: { id: true, batches: { orderBy: { expiryDate: "asc" } } },
          },
        },
      },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function getQueueCounts() {
  const [prescriptions, orders, h1Orders] = await Promise.all([
    db.prescription.count({
      where: {
        status: {
          in: [PrescriptionStatus.UPLOADED, PrescriptionStatus.UNDER_REVIEW],
        },
      },
    }),
    db.order.count({ where: { status: OrderStatus.PENDING_PHARMACIST_REVIEW } }),
    db.order.count({
      where: {
        status: OrderStatus.PENDING_PHARMACIST_REVIEW,
        containsH1Items: true,
      },
    }),
  ]);

  return { prescriptions, orders, h1Orders };
}

/**
 * A pharmacist's own action history.
 *
 * Read from the audit log rather than a separate table, so it cannot diverge
 * from the immutable record. A pharmacist is personally accountable for these
 * decisions under the Pharmacy Act, so they can see exactly what is recorded
 * against their registration.
 */
export async function getPharmacistActionLog(pharmacistId: string, take = 100) {
  return db.auditLog.findMany({
    where: {
      actorId: pharmacistId,
      action: {
        in: [
          "PRESCRIPTION_VERIFIED",
          "PRESCRIPTION_REJECTED",
          "PRESCRIPTION_CLARIFICATION_REQUESTED",
          "PRESCRIPTION_VIEWED",
          "H1_REGISTER_ENTRY_CREATED",
          "ORDER_STATUS_CHANGED",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** The pharmacist's own Schedule H1 register entries. */
export async function getH1RegisterEntries(filters?: {
  pharmacistId?: string;
  from?: Date;
  to?: Date;
  take?: number;
}) {
  return db.scheduleH1Register.findMany({
    where: {
      ...(filters?.pharmacistId ? { pharmacistId: filters.pharmacistId } : {}),
      ...(filters?.from || filters?.to
        ? {
            dispensedAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { serialNo: "desc" },
    take: filters?.take ?? 200,
    include: {
      order: { select: { orderNumber: true } },
      corrects: { select: { serialNo: true } },
    },
  });
}

export function isH1(scheduleType: ScheduleType): boolean {
  return scheduleType === ScheduleType.SCHEDULE_H1;
}
