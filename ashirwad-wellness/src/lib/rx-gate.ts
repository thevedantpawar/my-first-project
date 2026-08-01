import "server-only";
import { db } from "./db";
import { requiresPrescription } from "./schedule";
import { PrescriptionStatus, OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * THE RX GATE.
 *
 * This is the enforcement point. Everything visual in the application — the
 * ℞ badge, the tinted card, the notice at checkout — is a courtesy that tells
 * an honest customer what will happen. This function is what actually happens.
 *
 * Rules, all of which must hold for every Schedule H / H1 line:
 *
 *   1. A prescription is linked to the line.
 *   2. It belongs to the customer placing the order. (A prescription id is a
 *      cuid, but guessability is not a security model.)
 *   3. Its status is VERIFIED — set only by a pharmacist, never by a customer.
 *   4. It has not expired.
 *   5. Its dispensing budget is not exhausted.
 *
 * Never call this from a client component, never trust a boolean the client
 * sends about it, and never add a bypass flag "for testing". If it is hard to
 * test, the architecture is wrong — not the gate.
 *
 * Note on why an order still goes to PENDING_PHARMACIST_REVIEW after passing
 * this gate: this checks that a *verified* prescription is attached. Only a
 * pharmacist can confirm that the prescription actually covers these specific
 * drugs at these specific quantities. The two checks are not redundant.
 */

export type RxGateViolation = {
  productId: string;
  productName: string;
  reason:
    | "NO_PRESCRIPTION_LINKED"
    | "PRESCRIPTION_NOT_OWNED"
    | "PRESCRIPTION_NOT_VERIFIED"
    | "PRESCRIPTION_EXPIRED"
    | "PRESCRIPTION_EXHAUSTED";
  message: string;
};

export class RxGateError extends Error {
  readonly violations: RxGateViolation[];

  constructor(violations: RxGateViolation[]) {
    super(
      `Prescription gate refused this order: ${violations
        .map((v) => `${v.productName} — ${v.message}`)
        .join("; ")}`,
    );
    this.name = "RxGateError";
    this.violations = violations;
  }
}

export type GateLine = {
  productId: string;
  quantity: number;
  prescriptionId: string | null;
};

/**
 * Orders that count against a prescription's dispensing budget.
 * A cancelled or pharmacist-rejected order never dispensed anything, so it
 * must not consume a refill.
 */
const CONSUMING_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PHARMACIST_REVIEW,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

/**
 * How many times a prescription has already been dispensed against.
 *
 * Derived from OrderItem rather than read from a counter, so it cannot drift.
 * `Prescription.refillsUsed` is a denormalised mirror of this for display; if
 * the two ever disagree, this is right.
 */
async function dispensedCount(
  client: Prisma.TransactionClient,
  prescriptionId: string,
): Promise<number> {
  return client.orderItem.count({
    where: {
      prescriptionId,
      order: { status: { in: CONSUMING_STATUSES } },
    },
  });
}

/**
 * Total dispensings a prescription permits.
 *
 * `refillsAllowed` counts repeats *in addition to* the original supply, which
 * is how a prescriber writes it ("2 refills" = 3 supplies in total).
 */
function maxDispensings(refillsAllowed: number): number {
  return refillsAllowed + 1;
}

/**
 * Checks every line and returns the violations. Empty array means the order may
 * proceed to payment.
 *
 * Accepts a transaction client so the check and the order write are atomic —
 * without that, two concurrent checkouts could each see the last refill
 * available and both consume it.
 */
export async function findRxGateViolations(
  client: Prisma.TransactionClient,
  userId: string,
  lines: GateLine[],
): Promise<RxGateViolation[]> {
  const productIds = lines.map((l) => l.productId);

  // scheduleType is read from the database, never from the client. The CHECK
  // constraint guarantees requiresPrescription agrees with it.
  const products = await client.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      name: true,
      scheduleType: true,
      requiresPrescription: true,
    },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const violations: RxGateViolation[] = [];
  const now = new Date();

  for (const line of lines) {
    const product = productById.get(line.productId);

    if (!product) {
      violations.push({
        productId: line.productId,
        productName: "Unknown product",
        reason: "NO_PRESCRIPTION_LINKED",
        message:
          "This product is no longer available and cannot be ordered. Remove it from your cart.",
      });
      continue;
    }

    // Belt and braces: derive from scheduleType rather than trusting the
    // stored boolean, even though a CHECK constraint keeps them in agreement.
    if (!requiresPrescription(product.scheduleType)) continue;

    if (!line.prescriptionId) {
      violations.push({
        productId: product.id,
        productName: product.name,
        reason: "NO_PRESCRIPTION_LINKED",
        message: "No prescription has been attached to this item.",
      });
      continue;
    }

    const prescription = await client.prescription.findUnique({
      where: { id: line.prescriptionId },
      select: {
        id: true,
        userId: true,
        status: true,
        validUntil: true,
        refillsAllowed: true,
      },
    });

    if (!prescription || prescription.userId !== userId) {
      violations.push({
        productId: product.id,
        productName: product.name,
        reason: "PRESCRIPTION_NOT_OWNED",
        message: "The attached prescription does not belong to this account.",
      });
      continue;
    }

    if (prescription.status !== PrescriptionStatus.VERIFIED) {
      violations.push({
        productId: product.id,
        productName: product.name,
        reason: "PRESCRIPTION_NOT_VERIFIED",
        message:
          "The attached prescription has not yet been verified by a pharmacist.",
      });
      continue;
    }

    if (prescription.validUntil && prescription.validUntil < now) {
      violations.push({
        productId: product.id,
        productName: product.name,
        reason: "PRESCRIPTION_EXPIRED",
        message: `The attached prescription expired on ${prescription.validUntil.toLocaleDateString("en-IN")}.`,
      });
      continue;
    }

    const used = await dispensedCount(client, prescription.id);
    if (used >= maxDispensings(prescription.refillsAllowed)) {
      violations.push({
        productId: product.id,
        productName: product.name,
        reason: "PRESCRIPTION_EXHAUSTED",
        message:
          "The attached prescription has no repeats remaining. A new prescription is needed.",
      });
      continue;
    }
  }

  return violations;
}

/** Throws unless every prescription-only line is properly covered. */
export async function assertRxGate(
  client: Prisma.TransactionClient,
  userId: string,
  lines: GateLine[],
): Promise<void> {
  const violations = await findRxGateViolations(client, userId, lines);
  if (violations.length > 0) {
    throw new RxGateError(violations);
  }
}

/**
 * Advisory, read-only view of the gate for rendering the cart and checkout.
 *
 * Uses the same code path as the enforcement check, so the UI can never
 * disagree with what checkout will do. It is still advisory: the authoritative
 * call happens inside the order transaction.
 */
export async function previewRxGate(userId: string, lines: GateLine[]) {
  const violations = await findRxGateViolations(db, userId, lines);
  return {
    satisfied: violations.length === 0,
    violations,
    byProductId: new Map(violations.map((v) => [v.productId, v])),
  };
}

/**
 * Prescriptions the customer may attach to a line right now.
 * Mirrors the gate's own conditions, so the picker never offers something that
 * checkout would then refuse.
 */
export async function getUsablePrescriptions(userId: string) {
  const candidates = await db.prescription.findMany({
    where: {
      userId,
      status: PrescriptionStatus.VERIFIED,
      OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
    },
    select: {
      id: true,
      imageKey: true,
      doctorName: true,
      doctorRegNo: true,
      issuedOn: true,
      validUntil: true,
      refillsAllowed: true,
      verifiedAt: true,
      patient: { select: { fullName: true, relation: true } },
    },
    orderBy: { verifiedAt: "desc" },
  });

  const withBudget = await Promise.all(
    candidates.map(async (p) => ({
      ...p,
      dispensingsLeft:
        maxDispensings(p.refillsAllowed) - (await dispensedCount(db, p.id)),
    })),
  );

  return withBudget.filter((p) => p.dispensingsLeft > 0);
}
