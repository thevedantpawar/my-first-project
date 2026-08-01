"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireAdmin } from "@/auth";
import { audit } from "@/lib/audit";
import { OrderStatus } from "@/generated/prisma/enums";
import type { ActionResult } from "./cart";

/**
 * Admin operations: order status, serviceable pincodes, coupons, inventory.
 *
 * Note what is *not* here: nothing in this file can verify a prescription,
 * write to the Schedule H1 register, or edit the audit log. Dispensing
 * decisions belong to a registered pharmacist under the Pharmacy Act, and an
 * administrator is not automatically one.
 */

/** Legal forward transitions. Anything else is refused. */
const ALLOWED_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  CONFIRMED: [OrderStatus.PACKED, OrderStatus.CANCELLED],
  PACKED: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  SHIPPED: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RETURNED],
  OUT_FOR_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.RETURNED],
  DELIVERED: [OrderStatus.RETURNED],
  AWAITING_PAYMENT: [OrderStatus.CANCELLED],
};

const statusSchema = z.object({
  orderId: z.string().min(1).max(64),
  toStatus: z.nativeEnum(OrderStatus),
  note: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function updateOrderStatus(input: unknown): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const admin = await requireAdmin();
  const { orderId, toStatus, note } = parsed.data;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      containsRxItems: true,
      items: { select: { productId: true, quantity: true } },
    },
  });
  if (!order) return { ok: false, error: "Order not found." };

  // An administrator must never be able to move an order past pharmacist
  // review. That is a dispensing decision.
  if (order.status === OrderStatus.PENDING_PHARMACIST_REVIEW) {
    return {
      ok: false,
      error:
        "This order is awaiting pharmacist review. Only a registered pharmacist can release or decline it.",
    };
  }

  const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(toStatus)) {
    return {
      ok: false,
      error: `An order that is ${order.status.toLowerCase().replace(/_/g, " ")} cannot move to ${toStatus.toLowerCase().replace(/_/g, " ")}.`,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: toStatus,
        ...(toStatus === OrderStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
        ...(toStatus === OrderStatus.CANCELLED
          ? { cancelledAt: new Date(), cancellationReason: note || null }
          : {}),
      },
    });

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus,
        actorId: admin.id,
        note: note || null,
      },
    });

    // Cancelling or returning puts the stock back.
    if (toStatus === OrderStatus.CANCELLED || toStatus === OrderStatus.RETURNED) {
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }
  });

  await audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: toStatus === OrderStatus.CANCELLED ? "ORDER_CANCELLED" : "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: order.id,
    metadata: { orderNumber: order.orderNumber, from: order.status, to: toStatus, note },
  });

  revalidatePath("/admin/orders");
  return { ok: true, data: undefined };
}

const pincodeSchema = z.object({
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit pincode."),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80).default("Maharashtra"),
  etaHours: z.coerce.number().int().min(1).max(240).default(48),
  codAvailable: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export async function saveServiceablePincode(input: unknown): Promise<ActionResult> {
  const parsed = pincodeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the pincode details.",
    };
  }

  const admin = await requireAdmin();
  const data = parsed.data;

  await db.serviceablePincode.upsert({
    where: { pincode: data.pincode },
    update: data,
    create: data,
  });

  await audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: data.isActive ? "PINCODE_ENABLED" : "PINCODE_DISABLED",
    entityType: "ServiceablePincode",
    entityId: data.pincode,
    metadata: { city: data.city, codAvailable: data.codAvailable },
  });

  revalidatePath("/admin/pincodes");
  return { ok: true, data: undefined };
}

const togglePincodeSchema = z.object({
  pincode: z.string().min(6).max(6),
  isActive: z.boolean(),
});

export async function toggleServiceablePincode(input: unknown): Promise<ActionResult> {
  const parsed = togglePincodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const admin = await requireAdmin();

  await db.serviceablePincode.update({
    where: { pincode: parsed.data.pincode },
    data: { isActive: parsed.data.isActive },
  });

  await audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: parsed.data.isActive ? "PINCODE_ENABLED" : "PINCODE_DISABLED",
    entityType: "ServiceablePincode",
    entityId: parsed.data.pincode,
  });

  revalidatePath("/admin/pincodes");
  return { ok: true, data: undefined };
}

const couponSchema = z
  .object({
    code: z.string().trim().min(3).max(40).regex(/^[A-Z0-9-]+$/, "Codes use uppercase letters, numbers and hyphens."),
    description: z.string().trim().max(300).optional().or(z.literal("")),
    kind: z.enum(["percent", "flat"]),
    percentOff: z.coerce.number().int().min(1).max(100).optional(),
    flatOffPaise: z.coerce.number().int().min(1).max(10_000_000).optional(),
    maxDiscountPaise: z.coerce.number().int().min(0).max(10_000_000).optional(),
    minOrderPaise: z.coerce.number().int().min(0).max(10_000_000).default(0),
    usageLimit: z.coerce.number().int().min(1).max(1_000_000).optional(),
    perUserLimit: z.coerce.number().int().min(1).max(100).default(1),
    appliesToRxItems: z.boolean().default(false),
    startsAt: z.string().min(4),
    endsAt: z.string().min(4),
  })
  .refine((d) => (d.kind === "percent" ? d.percentOff !== undefined : d.flatOffPaise !== undefined), {
    message: "Enter the discount value.",
  });

export async function saveCoupon(input: unknown): Promise<ActionResult> {
  const parsed = couponSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the coupon details.",
    };
  }

  await requireAdmin();
  const d = parsed.data;

  const startsAt = new Date(d.startsAt);
  const endsAt = new Date(d.endsAt);
  if (endsAt <= startsAt) {
    return { ok: false, error: "The end date must be after the start date." };
  }

  const values = {
    description: d.description || null,
    // Exactly one discount kind — the database CHECK constraint enforces this
    // too, so an inconsistent pair cannot be written by any path.
    percentOff: d.kind === "percent" ? d.percentOff! : null,
    flatOffPaise: d.kind === "flat" ? d.flatOffPaise! : null,
    maxDiscountPaise: d.kind === "percent" ? d.maxDiscountPaise ?? null : null,
    minOrderPaise: d.minOrderPaise,
    usageLimit: d.usageLimit ?? null,
    perUserLimit: d.perUserLimit,
    appliesToRxItems: d.appliesToRxItems,
    startsAt,
    endsAt,
  };

  await db.coupon.upsert({
    where: { code: d.code },
    update: values,
    create: { code: d.code, ...values },
  });

  revalidatePath("/admin/coupons");
  return { ok: true, data: undefined };
}

const toggleCouponSchema = z.object({
  code: z.string().min(1).max(40),
  isActive: z.boolean(),
});

export async function toggleCoupon(input: unknown): Promise<ActionResult> {
  const parsed = toggleCouponSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  await requireAdmin();
  await db.coupon.update({
    where: { code: parsed.data.code },
    data: { isActive: parsed.data.isActive },
  });

  revalidatePath("/admin/coupons");
  return { ok: true, data: undefined };
}

const batchSchema = z.object({
  productId: z.string().min(1).max(64),
  batchNumber: z.string().trim().min(1).max(60),
  expiryDate: z.string().min(4).max(10),
  quantity: z.coerce.number().int().min(0).max(1_000_000),
  costPaise: z.coerce.number().int().min(0).max(10_000_000).optional(),
});

export async function saveInventoryBatch(input: unknown): Promise<ActionResult> {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the batch details.",
    };
  }

  const admin = await requireAdmin();
  const d = parsed.data;

  const expiryDate = new Date(d.expiryDate);
  if (expiryDate <= new Date()) {
    return {
      ok: false,
      error: "That batch has already expired and must not be added to sellable stock.",
    };
  }

  await db.inventoryBatch.upsert({
    where: {
      productId_batchNumber: {
        productId: d.productId,
        batchNumber: d.batchNumber,
      },
    },
    update: { expiryDate, quantity: d.quantity, costPaise: d.costPaise ?? null },
    create: {
      productId: d.productId,
      batchNumber: d.batchNumber,
      expiryDate,
      quantity: d.quantity,
      costPaise: d.costPaise ?? null,
    },
  });

  await audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: "INVENTORY_ADJUSTED",
    entityType: "InventoryBatch",
    entityId: `${d.productId}:${d.batchNumber}`,
    metadata: { quantity: d.quantity, expiryDate: d.expiryDate },
  });

  revalidatePath("/admin/inventory");
  return { ok: true, data: undefined };
}

const regNoSchema = z.object({
  userId: z.string().min(1).max(64),
  pharmacistRegNo: z.string().trim().min(3).max(60),
});

/**
 * Sets a pharmacist's registration number.
 *
 * Until this is set, `requirePharmacist` refuses every verification — the
 * number is stamped onto the statutory register and must be a real recorded
 * value, not an empty string.
 */
export async function setPharmacistRegNo(input: unknown): Promise<ActionResult> {
  const parsed = regNoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid registration number." };
  }

  const admin = await requireAdmin();

  const user = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, role: true, email: true },
  });
  if (!user) return { ok: false, error: "User not found." };
  if (user.role !== "PHARMACIST" && user.role !== "ADMIN") {
    return {
      ok: false,
      error: "A registration number can only be set on a pharmacist account.",
    };
  }

  await db.user.update({
    where: { id: user.id },
    data: { pharmacistRegNo: parsed.data.pharmacistRegNo },
  });

  await audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: "USER_REGISTER",
    entityType: "User",
    entityId: user.id,
    metadata: {
      change: "pharmacistRegNo set",
      email: user.email,
      pharmacistRegNo: parsed.data.pharmacistRegNo,
    },
  });

  revalidatePath("/admin/staff");
  return { ok: true, data: undefined };
}
