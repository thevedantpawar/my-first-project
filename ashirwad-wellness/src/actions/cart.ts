"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireUser } from "@/auth";
import { getOrCreateCart, mergeGuestCart } from "@/lib/cart";
import { PrescriptionStatus } from "@/generated/prisma/enums";

/**
 * Cart mutations.
 *
 * Every action re-reads the product from the database. Nothing about price,
 * stock, schedule type or per-order limits is accepted from the caller — a
 * Server Action is a public HTTP endpoint, and this one assumes the client is
 * hostile.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const addToCartSchema = z.object({
  productId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(100).default(1),
});

export async function addToCart(input: unknown): Promise<ActionResult> {
  const parsed = addToCartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "Please sign in to add items to your cart." };
  }

  const product = await db.product.findFirst({
    where: { id: parsed.data.productId, isActive: true },
    select: { id: true, stock: true, maxPerOrder: true, name: true },
  });

  if (!product) return { ok: false, error: "This product is not available." };
  if (product.stock <= 0) {
    return { ok: false, error: `${product.name} is out of stock.` };
  }

  const cart = await getOrCreateCart(user.id);

  const existing = await db.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    select: { quantity: true },
  });

  const requested = (existing?.quantity ?? 0) + parsed.data.quantity;
  const allowed = Math.min(product.maxPerOrder, product.stock);

  if (requested > allowed) {
    return {
      ok: false,
      error:
        existing
          ? `You already have the maximum of ${allowed} in your cart.`
          : `Only ${allowed} available per order.`,
    };
  }

  await db.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    update: { quantity: requested },
    create: { cartId: cart.id, productId: product.id, quantity: requested },
  });

  revalidatePath("/cart");
  return { ok: true, data: undefined };
}

const updateQuantitySchema = z.object({
  cartItemId: z.string().min(1).max(64),
  quantity: z.number().int().min(0).max(100),
});

export async function updateCartQuantity(input: unknown): Promise<ActionResult> {
  const parsed = updateQuantitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  // Ownership is checked by scoping the lookup to this user's cart, not by
  // trusting that the id came from their own page.
  const item = await db.cartItem.findFirst({
    where: { id: parsed.data.cartItemId, cart: { userId: user.id } },
    select: {
      id: true,
      product: { select: { stock: true, maxPerOrder: true, name: true } },
    },
  });

  if (!item) return { ok: false, error: "That item is not in your cart." };

  if (parsed.data.quantity === 0) {
    await db.cartItem.delete({ where: { id: item.id } });
    revalidatePath("/cart");
    return { ok: true, data: undefined };
  }

  const allowed = Math.min(item.product.maxPerOrder, item.product.stock);
  if (parsed.data.quantity > allowed) {
    return { ok: false, error: `Only ${allowed} available per order.` };
  }

  await db.cartItem.update({
    where: { id: item.id },
    data: { quantity: parsed.data.quantity },
  });

  revalidatePath("/cart");
  return { ok: true, data: undefined };
}

const removeSchema = z.object({ cartItemId: z.string().min(1).max(64) });

export async function removeFromCart(input: unknown): Promise<ActionResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  const deleted = await db.cartItem.deleteMany({
    where: { id: parsed.data.cartItemId, cart: { userId: user.id } },
  });

  if (deleted.count === 0) {
    return { ok: false, error: "That item is not in your cart." };
  }

  revalidatePath("/cart");
  return { ok: true, data: undefined };
}

const linkSchema = z.object({
  cartItemId: z.string().min(1).max(64),
  prescriptionId: z.string().min(1).max(64).nullable(),
});

/**
 * Attaches a prescription to a specific cart line.
 *
 * This is a convenience, not an authorisation: linking an unverified
 * prescription is permitted (the customer may upload before it is reviewed),
 * and the gate at checkout is what refuses to let it through. What is NOT
 * permitted is linking a prescription belonging to someone else.
 */
export async function linkPrescriptionToItem(
  input: unknown,
): Promise<ActionResult> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  const item = await db.cartItem.findFirst({
    where: { id: parsed.data.cartItemId, cart: { userId: user.id } },
    select: { id: true, product: { select: { requiresPrescription: true } } },
  });

  if (!item) return { ok: false, error: "That item is not in your cart." };

  if (parsed.data.prescriptionId === null) {
    await db.cartItem.update({
      where: { id: item.id },
      data: { prescriptionId: null },
    });
    revalidatePath("/cart");
    revalidatePath("/checkout");
    return { ok: true, data: undefined };
  }

  const prescription = await db.prescription.findFirst({
    where: { id: parsed.data.prescriptionId, userId: user.id },
    select: { id: true, status: true },
  });

  if (!prescription) {
    return { ok: false, error: "That prescription is not on your account." };
  }

  if (prescription.status === PrescriptionStatus.REJECTED) {
    return {
      ok: false,
      error:
        "That prescription was rejected by a pharmacist and cannot be used. Please upload a new one.",
    };
  }

  await db.cartItem.update({
    where: { id: item.id },
    data: { prescriptionId: prescription.id },
  });

  revalidatePath("/cart");
  revalidatePath("/checkout");
  return { ok: true, data: undefined };
}

const mergeSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .max(100),
});

/** Reconciles the guest localStorage cart into the database cart on sign-in. */
export async function mergeGuestCartAction(input: unknown): Promise<ActionResult> {
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();
  await mergeGuestCart(user.id, parsed.data.items);

  revalidatePath("/cart");
  return { ok: true, data: undefined };
}
