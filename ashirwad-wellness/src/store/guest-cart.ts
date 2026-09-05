"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Guest cart.
 *
 * Signed-out visitors need somewhere to put things, but a localStorage cart is
 * a UI convenience and nothing more. It stores product ids and quantities only
 * — never prices, never prescription linkage — because everything that
 * determines what an order costs or what it may contain is recomputed
 * server-side at checkout from the database.
 *
 * On sign-in this is merged into the database cart and cleared.
 */

export type GuestCartItem = {
  productId: string;
  quantity: number;
};

type GuestCartState = {
  items: GuestCartItem[];
  add: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  count: () => number;
};

export const useGuestCart = create<GuestCartState>()(
  persist(
    (set, get) => ({
      items: [],

      add: (productId, quantity = 1) =>
        set((state) => {
          const existing = state.items.find((i) => i.productId === productId);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.productId === productId
                  ? { ...i, quantity: Math.min(i.quantity + quantity, 100) }
                  : i,
              ),
            };
          }
          return { items: [...state.items, { productId, quantity }] };
        }),

      setQuantity: (productId, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.productId !== productId)
              : state.items.map((i) =>
                  i.productId === productId ? { ...i, quantity } : i,
                ),
        })),

      remove: (productId) =>
        set((state) => ({
          items: state.items.filter((i) => i.productId !== productId),
        })),

      clear: () => set({ items: [] }),

      count: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    { name: "ashirwad-guest-cart", version: 1 },
  ),
);
