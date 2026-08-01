"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShoppingCart } from "lucide-react";

import { addToCart } from "@/actions/cart";
import { useGuestCart } from "@/store/guest-cart";

export function AddToCartButton({
  productId,
  isSignedIn,
  disabled,
  className = "",
}: {
  productId: string;
  isSignedIn: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const guestCart = useGuestCart();
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);

    // Signed out: hold it locally. It is merged server-side on sign-in, where
    // stock and per-order limits are applied properly.
    if (!isSignedIn) {
      guestCart.add(productId);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
      return;
    }

    startTransition(async () => {
      const result = await addToCart({ productId, quantity: 1 });
      if (result.ok) {
        setAdded(true);
        router.refresh();
        setTimeout(() => setAdded(false), 2000);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || pending}
        className={`flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-living-600 px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-living-700 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-300 ${className}`}
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : added ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <ShoppingCart aria-hidden="true" className="size-4" />
        )}
        {added ? "Added to cart" : "Add to cart"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-xs text-rx-700">
          {error}
        </p>
      )}

      {!isSignedIn && added && (
        <p className="mt-2 text-center text-[0.6875rem] text-ink-500">
          Sign in at checkout to complete your order.
        </p>
      )}
    </div>
  );
}
