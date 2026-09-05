import "server-only";
import { db } from "./db";
import { gstComponentPaise } from "./money";
import { requiresPrescription } from "./schedule";
import { policy } from "./pharmacy";
import { PaymentMethod } from "@/generated/prisma/enums";
import type { ScheduleType } from "@/generated/prisma/enums";

/**
 * Order pricing.
 *
 * Every figure is integer paise. The totals computed here are the ones written
 * to the order and shown on the invoice, so this runs server-side only — a
 * client-supplied total is never trusted or even accepted.
 *
 * Indian pharmacy pricing is inclusive of GST: the printed MRP already contains
 * the tax, so tax is *extracted* from the line total rather than added to it.
 */

export type PricedLine = {
  productId: string;
  name: string;
  quantity: number;
  scheduleType: ScheduleType;
  requiresPrescription: boolean;
  mrpPaise: number;
  sellingPricePaise: number;
  lineTotalPaise: number;
  lineGstPaise: number;
  gstRateBps: number;
  savingsPaise: number;
};

export type CouponFailure =
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "USAGE_LIMIT_REACHED"
  | "PER_USER_LIMIT_REACHED"
  | "MIN_ORDER_NOT_MET"
  | "NO_ELIGIBLE_ITEMS";

export const COUPON_FAILURE_MESSAGE: Record<CouponFailure, string> = {
  NOT_FOUND: "That coupon code is not recognised.",
  INACTIVE: "That coupon is no longer active.",
  NOT_STARTED: "That coupon is not valid yet.",
  EXPIRED: "That coupon has expired.",
  USAGE_LIMIT_REACHED: "That coupon has been fully redeemed.",
  PER_USER_LIMIT_REACHED: "You have already used that coupon.",
  MIN_ORDER_NOT_MET: "Your order value is below this coupon's minimum.",
  NO_ELIGIBLE_ITEMS:
    "This coupon does not apply to prescription medicines, and there are no other items in your cart.",
};

export type AppliedCoupon = {
  id: string;
  code: string;
  discountPaise: number;
};

export type OrderTotals = {
  lines: PricedLine[];
  subtotalPaise: number;
  discountPaise: number;
  deliveryPaise: number;
  gstPaise: number;
  totalPaise: number;
  savingsPaise: number;
  coupon: AppliedCoupon | null;
  couponError: CouponFailure | null;
  containsRxItems: boolean;
  containsH1Items: boolean;
};

/** Free delivery above this value; a flat fee below it. */
const FREE_DELIVERY_THRESHOLD_PAISE = 49_900;
const DELIVERY_FEE_PAISE = 4_000;

export function priceLines(
  items: {
    quantity: number;
    product: {
      id: string;
      name: string;
      scheduleType: ScheduleType;
      requiresPrescription: boolean;
      mrpPaise: number;
      sellingPricePaise: number;
      gstRateBps: number;
    };
  }[],
): PricedLine[] {
  return items.map(({ quantity, product }) => {
    const lineTotalPaise = product.sellingPricePaise * quantity;
    return {
      productId: product.id,
      name: product.name,
      quantity,
      scheduleType: product.scheduleType,
      // Derived, not read — consistent with the gate.
      requiresPrescription: requiresPrescription(product.scheduleType),
      mrpPaise: product.mrpPaise,
      sellingPricePaise: product.sellingPricePaise,
      lineTotalPaise,
      lineGstPaise: gstComponentPaise(lineTotalPaise, product.gstRateBps),
      gstRateBps: product.gstRateBps,
      savingsPaise: Math.max(
        0,
        (product.mrpPaise - product.sellingPricePaise) * quantity,
      ),
    };
  });
}

/**
 * Resolves and values a coupon.
 *
 * Discount applies only to the eligible subtotal. Prescription medicines are
 * excluded unless the coupon explicitly opts in via `appliesToRxItems` —
 * discounting Rx medicines is a policy decision, so the default is not to.
 */
async function resolveCoupon(
  code: string,
  userId: string,
  lines: PricedLine[],
): Promise<{ coupon: AppliedCoupon | null; error: CouponFailure | null }> {
  const coupon = await db.coupon.findUnique({
    where: { code: code.trim().toUpperCase() },
  });

  if (!coupon) return { coupon: null, error: "NOT_FOUND" };
  if (!coupon.isActive) return { coupon: null, error: "INACTIVE" };

  const now = new Date();
  if (coupon.startsAt > now) return { coupon: null, error: "NOT_STARTED" };
  if (coupon.endsAt < now) return { coupon: null, error: "EXPIRED" };

  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
    return { coupon: null, error: "USAGE_LIMIT_REACHED" };
  }

  const usedByThisCustomer = await db.order.count({
    where: { userId, couponId: coupon.id, status: { not: "CANCELLED" } },
  });
  if (usedByThisCustomer >= coupon.perUserLimit) {
    return { coupon: null, error: "PER_USER_LIMIT_REACHED" };
  }

  const eligible = coupon.appliesToRxItems
    ? lines
    : lines.filter((l) => !l.requiresPrescription);

  const eligibleSubtotal = eligible.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  if (eligibleSubtotal === 0) {
    return { coupon: null, error: "NO_ELIGIBLE_ITEMS" };
  }

  const orderSubtotal = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  if (orderSubtotal < coupon.minOrderPaise) {
    return { coupon: null, error: "MIN_ORDER_NOT_MET" };
  }

  let discountPaise: number;
  if (coupon.percentOff !== null) {
    discountPaise = Math.floor((eligibleSubtotal * coupon.percentOff) / 100);
    if (coupon.maxDiscountPaise !== null) {
      discountPaise = Math.min(discountPaise, coupon.maxDiscountPaise);
    }
  } else {
    discountPaise = coupon.flatOffPaise ?? 0;
  }

  // A discount can never exceed what it applies to.
  discountPaise = Math.min(discountPaise, eligibleSubtotal);

  return {
    coupon: { id: coupon.id, code: coupon.code, discountPaise },
    error: null,
  };
}

export async function computeTotals(
  items: Parameters<typeof priceLines>[0],
  options: { userId: string; couponCode?: string | null },
): Promise<OrderTotals> {
  const lines = priceLines(items);

  const subtotalPaise = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  const savingsPaise = lines.reduce((sum, l) => sum + l.savingsPaise, 0);

  let coupon: AppliedCoupon | null = null;
  let couponError: CouponFailure | null = null;

  if (options.couponCode?.trim()) {
    const resolved = await resolveCoupon(
      options.couponCode,
      options.userId,
      lines,
    );
    coupon = resolved.coupon;
    couponError = resolved.error;
  }

  const discountPaise = coupon?.discountPaise ?? 0;
  const afterDiscount = subtotalPaise - discountPaise;

  const deliveryPaise =
    afterDiscount >= FREE_DELIVERY_THRESHOLD_PAISE || afterDiscount === 0
      ? 0
      : DELIVERY_FEE_PAISE;

  // GST is extracted from the discounted line values, not added on top.
  const gstPaise = lines.reduce((sum, l) => {
    const share = subtotalPaise > 0 ? l.lineTotalPaise / subtotalPaise : 0;
    const discountedLine = l.lineTotalPaise - discountPaise * share;
    return sum + gstComponentPaise(Math.max(0, discountedLine), l.gstRateBps);
  }, 0);

  return {
    lines,
    subtotalPaise,
    discountPaise,
    deliveryPaise,
    gstPaise,
    totalPaise: afterDiscount + deliveryPaise,
    savingsPaise,
    coupon,
    couponError,
    containsRxItems: lines.some((l) => l.requiresPrescription),
    containsH1Items: lines.some((l) => l.scheduleType === "SCHEDULE_H1"),
  };
}

/**
 * Payment methods available for a given order value.
 *
 * The COD ceiling is enforced here and re-checked inside the order
 * transaction. A client that posts `paymentMethod: COD` on a ₹10,000 order is
 * rejected server-side, not merely hidden from in the UI.
 */
export function availablePaymentMethods(totalPaise: number): {
  method: PaymentMethod;
  available: boolean;
  reason?: string;
}[] {
  const razorpayConfigured = Boolean(
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
  );

  return [
    {
      method: PaymentMethod.RAZORPAY,
      available: razorpayConfigured,
      reason: razorpayConfigured
        ? undefined
        : "Online payment is not configured on this deployment.",
    },
    {
      method: PaymentMethod.COD,
      available: totalPaise <= policy.codCeilingPaise,
      reason:
        totalPaise <= policy.codCeilingPaise
          ? undefined
          : `Cash on delivery is available on orders up to ₹${(policy.codCeilingPaise / 100).toLocaleString("en-IN")}.`,
    },
  ];
}

export function isCodAllowed(totalPaise: number): boolean {
  return totalPaise <= policy.codCeilingPaise;
}
