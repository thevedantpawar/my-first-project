import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay, test mode.
 *
 * Deliberately not using the SDK: the two calls needed here are a POST to
 * create an order and an HMAC check on the callback, and a thin wrapper makes
 * the signature verification legible rather than hidden.
 *
 * The signature check is the security boundary. A client can post any
 * payment id it likes to the confirmation endpoint; only Razorpay can produce
 * a signature over `order_id|payment_id` using the key secret.
 */

const API_BASE = "https://api.razorpay.com/v1";

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
    );
  }
  return { keyId, keySecret };
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

/**
 * Creates a Razorpay order.
 *
 * `amountPaise` is passed through unchanged — Razorpay also works in paise, so
 * there is no unit conversion here and no opportunity for a rounding error
 * between our total and theirs.
 */
export async function createRazorpayOrder(params: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const { keyId, keySecret } = credentials();

  const response = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: "INR",
      receipt: params.receipt,
      notes: params.notes,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Razorpay order creation failed (${response.status}): ${detail}`);
  }

  return (await response.json()) as RazorpayOrder;
}

/**
 * Verifies the callback signature.
 *
 * Constant-time comparison, because a timing oracle on a payment signature is
 * exactly the kind of thing that is cheap to prevent and expensive to discover.
 */
export function verifyPaymentSignature(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  const { keySecret } = credentials();

  const expected = createHmac("sha256", keySecret)
    .update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(params.signature, "utf8");

  return a.length === b.length && timingSafeEqual(a, b);
}
