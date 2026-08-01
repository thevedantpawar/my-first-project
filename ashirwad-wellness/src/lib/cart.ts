import "server-only";
import { db } from "./db";
import { previewRxGate, type GateLine } from "./rx-gate";
import { computeTotals } from "./pricing";

/**
 * Server-side cart.
 *
 * The Zustand store is a guest-only convenience that lives in localStorage.
 * Once signed in, the database cart is authoritative — prices, stock and
 * prescription linkage are all re-read here, so a tampered localStorage
 * payload cannot change what an order costs or what it is allowed to contain.
 */

export const CART_ITEM_SELECT = {
  id: true,
  quantity: true,
  prescriptionId: true,
  product: {
    select: {
      id: true,
      name: true,
      nameHi: true,
      slug: true,
      images: true,
      composition: true,
      strength: true,
      packSize: true,
      form: true,
      scheduleType: true,
      requiresPrescription: true,
      mrpPaise: true,
      sellingPricePaise: true,
      gstRateBps: true,
      // Required for the OrderItem snapshot and therefore for a compliant
      // tax invoice. Selected here so checkout never has to re-query.
      hsnCode: true,
      manufacturer: { select: { name: true } },
      stock: true,
      maxPerOrder: true,
      isActive: true,
    },
  },
} as const;

export async function getOrCreateCart(userId: string) {
  const existing = await db.cart.findUnique({ where: { userId } });
  if (existing) return existing;
  return db.cart.create({ data: { userId } });
}

export async function getCartItems(userId: string) {
  const cart = await db.cart.findUnique({
    where: { userId },
    select: { items: { select: CART_ITEM_SELECT, orderBy: { createdAt: "asc" } } },
  });
  // A delisted product must vanish from the cart rather than block checkout.
  return (cart?.items ?? []).filter((i) => i.product.isActive);
}

export type CartView = Awaited<ReturnType<typeof getCartView>>;

/**
 * Everything the cart and checkout pages render.
 *
 * The Rx gate preview uses the same code path as enforcement, so what the
 * customer is shown can never disagree with what checkout will do.
 */
export async function getCartView(userId: string, couponCode?: string | null) {
  const items = await getCartItems(userId);

  const gateLines: GateLine[] = items.map((i) => ({
    productId: i.product.id,
    quantity: i.quantity,
    prescriptionId: i.prescriptionId,
  }));

  const [totals, gate] = await Promise.all([
    computeTotals(items, { userId, couponCode }),
    previewRxGate(userId, gateLines),
  ]);

  const rxItems = items.filter((i) => i.product.requiresPrescription);
  const otcItems = items.filter((i) => !i.product.requiresPrescription);

  const outOfStock = items.filter((i) => i.product.stock < i.quantity);

  return {
    items,
    rxItems,
    otcItems,
    totals,
    gate,
    outOfStock,
    isEmpty: items.length === 0,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
  };
}

export async function getCartCount(userId: string): Promise<number> {
  const result = await db.cartItem.aggregate({
    where: { cart: { userId } },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/**
 * Merges a guest cart into the database cart on sign-in.
 *
 * Quantities are summed and then clamped to the product's per-order limit.
 * Prescription linkage is deliberately NOT accepted from the guest payload —
 * a signed-out visitor has no prescriptions, so anything claiming otherwise is
 * either stale or forged.
 */
export async function mergeGuestCart(
  userId: string,
  guestItems: { productId: string; quantity: number }[],
): Promise<void> {
  if (guestItems.length === 0) return;

  const cart = await getOrCreateCart(userId);

  const products = await db.product.findMany({
    where: {
      id: { in: guestItems.map((i) => i.productId) },
      isActive: true,
    },
    select: { id: true, maxPerOrder: true, stock: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  for (const guestItem of guestItems) {
    const product = productById.get(guestItem.productId);
    if (!product) continue;

    const existing = await db.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      select: { quantity: true },
    });

    const merged = (existing?.quantity ?? 0) + guestItem.quantity;
    const clamped = Math.max(
      1,
      Math.min(merged, product.maxPerOrder, Math.max(product.stock, 1)),
    );

    await db.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      update: { quantity: clamped },
      create: { cartId: cart.id, productId: product.id, quantity: clamped },
    });
  }
}
