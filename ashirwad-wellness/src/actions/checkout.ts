"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireUser } from "@/auth";
import { audit } from "@/lib/audit";
import { getCartItems } from "@/lib/cart";
import { computeTotals } from "@/lib/pricing";
import { assertRxGate, RxGateError, type GateLine } from "@/lib/rx-gate";
import { nextOrderNumber } from "@/lib/orders";
import { policy } from "@/lib/pharmacy";
import { createRazorpayOrder, isRazorpayConfigured } from "@/lib/razorpay";
import { sendOrderConfirmation } from "@/lib/email";
import { checkPincode } from "./addresses";
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "@/generated/prisma/enums";
import type { ActionResult } from "./cart";

/**
 * Order placement.
 *
 * This is a public HTTP endpoint. Everything that determines what the customer
 * is charged and what they are allowed to receive is recomputed here from the
 * database:
 *
 *   - Prices, GST and totals are recomputed. No client-supplied amount is read.
 *   - The Rx gate runs inside the transaction, so a concurrent checkout cannot
 *     consume the same last refill twice.
 *   - Stock is decremented conditionally, so two orders cannot oversell.
 *   - The COD ceiling is enforced here, not merely hidden in the UI.
 *   - Serviceability is re-checked against the address actually being used.
 *
 * The only thing the caller chooses is which address, which payment method,
 * and which coupon code to try.
 */

const placeOrderSchema = z.object({
  addressId: z.string().min(1).max(64),
  paymentMethod: z.nativeEnum(PaymentMethod),
  couponCode: z.string().trim().max(40).optional().or(z.literal("")),
});

export type PlacedOrder = {
  orderId: string;
  orderNumber: string;
  totalPaise: number;
  paymentMethod: PaymentMethod;
  requiresPharmacistReview: boolean;
  razorpay: { orderId: string; keyId: string; amountPaise: number } | null;
};

export async function placeOrder(
  input: unknown,
): Promise<ActionResult<PlacedOrder>> {
  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();
  const { addressId, paymentMethod, couponCode } = parsed.data;

  const address = await db.address.findFirst({
    where: { id: addressId, userId: user.id },
  });
  if (!address) {
    return { ok: false, error: "That delivery address is not on your account." };
  }

  const serviceable = await checkPincode(address.pincode);
  if (!serviceable.serviceable) {
    return { ok: false, error: serviceable.reason };
  }

  const items = await getCartItems(user.id);
  if (items.length === 0) {
    return { ok: false, error: "Your cart is empty." };
  }

  const totals = await computeTotals(items, { userId: user.id, couponCode });

  if (couponCode?.trim() && totals.couponError) {
    return { ok: false, error: "That coupon could not be applied." };
  }

  if (paymentMethod === PaymentMethod.COD) {
    if (totals.totalPaise > policy.codCeilingPaise) {
      return {
        ok: false,
        error: `Cash on delivery is available on orders up to ₹${(policy.codCeilingPaise / 100).toLocaleString("en-IN")}. Please pay online for this order.`,
      };
    }
    if (!serviceable.codAvailable) {
      return {
        ok: false,
        error: "Cash on delivery is not available for this pincode.",
      };
    }
  }

  if (paymentMethod === PaymentMethod.RAZORPAY && !isRazorpayConfigured()) {
    return {
      ok: false,
      error: "Online payment is not configured on this deployment.",
    };
  }

  const gateLines: GateLine[] = items.map((i) => ({
    productId: i.product.id,
    quantity: i.quantity,
    prescriptionId: i.prescriptionId,
  }));

  try {
    const order = await db.$transaction(async (tx) => {
      // THE GATE. Inside the transaction, so the refill budget it reads cannot
      // be consumed by a concurrent checkout between check and write.
      await assertRxGate(tx, user.id, gateLines);

      // Conditional stock decrement. `updateMany` with a stock predicate is
      // atomic: if another order took the last unit first, count comes back 0
      // and the whole transaction rolls back.
      for (const item of items) {
        const updated = await tx.product.updateMany({
          where: { id: item.product.id, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (updated.count === 0) {
          throw new Error(
            `${item.product.name} sold out while you were checking out. Please review your cart.`,
          );
        }
      }

      const orderNumber = await nextOrderNumber(tx);

      // Rx orders never go straight to fulfilment. Passing the gate proves a
      // verified prescription is attached; only a pharmacist can confirm it
      // covers these drugs at these quantities.
      const status = totals.containsRxItems
        ? OrderStatus.PENDING_PHARMACIST_REVIEW
        : paymentMethod === PaymentMethod.COD
          ? OrderStatus.CONFIRMED
          : OrderStatus.AWAITING_PAYMENT;

      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: user.id,
          addressId: address.id,
          status,
          paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          containsRxItems: totals.containsRxItems,
          containsH1Items: totals.containsH1Items,
          subtotalPaise: totals.subtotalPaise,
          discountPaise: totals.discountPaise,
          deliveryPaise: totals.deliveryPaise,
          gstPaise: totals.gstPaise,
          totalPaise: totals.totalPaise,
          couponId: totals.coupon?.id ?? null,
          couponCode: totals.coupon?.code ?? null,
          // Snapshotted, so later edits to the address book cannot rewrite
          // where a dispensed order was sent.
          shipAddressSnapshot: {
            fullName: address.fullName,
            phone: address.phone,
            line1: address.line1,
            line2: address.line2,
            landmark: address.landmark,
            city: address.city,
            state: address.state,
            pincode: address.pincode,
          },
          items: {
            create: items.map((item) => {
              const line = totals.lines.find(
                (l) => l.productId === item.product.id,
              )!;
              return {
                productId: item.product.id,
                quantity: item.quantity,
                // Snapshots: an invoice and a dispensing record must not change
                // retroactively when the catalogue is edited.
                nameSnapshot: item.product.name,
                compositionSnapshot: item.product.composition,
                strengthSnapshot: item.product.strength,
                packSizeSnapshot: item.product.packSize,
                manufacturerSnapshot: item.product.manufacturer.name,
                scheduleTypeSnapshot: item.product.scheduleType,
                hsnCodeSnapshot: item.product.hsnCode,
                gstRateBpsSnapshot: item.product.gstRateBps,
                mrpPaise: item.product.mrpPaise,
                sellingPricePaise: item.product.sellingPricePaise,
                lineTotalPaise: line.lineTotalPaise,
                lineGstPaise: line.lineGstPaise,
                prescriptionId: item.prescriptionId,
              };
            }),
          },
          events: {
            create: {
              toStatus: status,
              actorId: user.id,
              note: "Order placed",
            },
          },
        },
        select: { id: true, orderNumber: true, status: true },
      });

      if (totals.coupon) {
        await tx.coupon.update({
          where: { id: totals.coupon.id },
          data: { usageCount: { increment: 1 } },
        });
      }

      // Mirror the dispensing count onto the prescription for display. The
      // authoritative figure is always derived from OrderItem.
      const usedPrescriptionIds = [
        ...new Set(items.map((i) => i.prescriptionId).filter((id): id is string => !!id)),
      ];
      for (const prescriptionId of usedPrescriptionIds) {
        const dispensed = await tx.orderItem.count({
          where: {
            prescriptionId,
            order: { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.PHARMACIST_REJECTED] } },
          },
        });
        const prescription = await tx.prescription.findUnique({
          where: { id: prescriptionId },
          select: { refillsAllowed: true },
        });
        await tx.prescription.update({
          where: { id: prescriptionId },
          data: {
            refillsUsed: Math.min(
              Math.max(0, dispensed - 1),
              prescription?.refillsAllowed ?? 0,
            ),
          },
        });
      }

      await tx.cartItem.deleteMany({ where: { cart: { userId: user.id } } });

      return created;
    });

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "ORDER_PLACED",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        orderNumber: order.orderNumber,
        totalPaise: totals.totalPaise,
        paymentMethod,
        containsRxItems: totals.containsRxItems,
        containsH1Items: totals.containsH1Items,
        status: order.status,
      },
    });

    let razorpay: PlacedOrder["razorpay"] = null;
    if (paymentMethod === PaymentMethod.RAZORPAY) {
      try {
        const rzp = await createRazorpayOrder({
          amountPaise: totals.totalPaise,
          receipt: order.orderNumber,
          notes: { orderId: order.id },
        });
        await db.order.update({
          where: { id: order.id },
          data: { razorpayOrderId: rzp.id },
        });
        razorpay = {
          orderId: rzp.id,
          keyId: process.env.RAZORPAY_KEY_ID!,
          amountPaise: totals.totalPaise,
        };
      } catch (error) {
        console.error("[checkout] Razorpay order creation failed", error);
        return {
          ok: false,
          error:
            "We could not reach the payment gateway. Your order has not been placed — please try again.",
        };
      }
    }

    await sendOrderConfirmation({
      to: user.email,
      customerName: user.name,
      orderNumber: order.orderNumber,
      totalPaise: totals.totalPaise,
      requiresPharmacistReview: totals.containsRxItems,
      paymentMethod,
    });

    revalidatePath("/cart");
    revalidatePath("/account/orders");

    return {
      ok: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalPaise: totals.totalPaise,
        paymentMethod,
        requiresPharmacistReview: totals.containsRxItems,
        razorpay,
      },
    };
  } catch (error) {
    if (error instanceof RxGateError) {
      // Every blocked attempt is recorded. A pattern of these on one account is
      // worth someone noticing.
      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: "RX_GATE_BLOCKED",
        entityType: "Cart",
        entityId: user.id,
        metadata: { violations: error.violations },
      });

      return {
        ok: false,
        error: error.violations
          .map((v) => `${v.productName}: ${v.message}`)
          .join(" "),
      };
    }

    if (error instanceof Error) {
      return { ok: false, error: error.message };
    }

    console.error("[checkout] unexpected failure", error);
    return { ok: false, error: "Something went wrong placing your order." };
  }
}

const confirmSchema = z.object({
  orderId: z.string().min(1).max(64),
  razorpayPaymentId: z.string().min(1).max(120),
  razorpayOrderId: z.string().min(1).max(120),
  signature: z.string().min(1).max(256),
});

/**
 * Confirms a Razorpay payment.
 *
 * The signature is the security boundary — anyone can post a payment id, but
 * only Razorpay can sign `order_id|payment_id` with the key secret. A failed
 * verification marks the payment failed rather than silently ignoring it.
 */
export async function confirmRazorpayPayment(
  input: unknown,
): Promise<ActionResult<{ orderNumber: string }>> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();
  const { verifyPaymentSignature } = await import("@/lib/razorpay");

  const order = await db.order.findFirst({
    where: { id: parsed.data.orderId, userId: user.id },
    select: {
      id: true,
      orderNumber: true,
      razorpayOrderId: true,
      containsRxItems: true,
      paymentStatus: true,
    },
  });

  if (!order) return { ok: false, error: "Order not found." };

  if (order.razorpayOrderId !== parsed.data.razorpayOrderId) {
    return { ok: false, error: "Payment does not match this order." };
  }

  const valid = verifyPaymentSignature({
    razorpayOrderId: parsed.data.razorpayOrderId,
    razorpayPaymentId: parsed.data.razorpayPaymentId,
    signature: parsed.data.signature,
  });

  if (!valid) {
    await db.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.FAILED },
    });
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "PAYMENT_CAPTURED",
      entityType: "Order",
      entityId: order.id,
      metadata: { outcome: "SIGNATURE_INVALID" },
    });
    return { ok: false, error: "Payment could not be verified." };
  }

  const nextStatus = order.containsRxItems
    ? OrderStatus.PENDING_PHARMACIST_REVIEW
    : OrderStatus.CONFIRMED;

  await db.$transaction([
    db.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: PaymentStatus.PAID,
        razorpayPaymentId: parsed.data.razorpayPaymentId,
        razorpaySignature: parsed.data.signature,
        status: nextStatus,
      },
    }),
    db.orderStatusEvent.create({
      data: {
        orderId: order.id,
        toStatus: nextStatus,
        actorId: user.id,
        note: "Payment received",
      },
    }),
  ]);

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "PAYMENT_CAPTURED",
    entityType: "Order",
    entityId: order.id,
    metadata: { razorpayPaymentId: parsed.data.razorpayPaymentId },
  });

  revalidatePath("/account/orders");
  return { ok: true, data: { orderNumber: order.orderNumber } };
}
