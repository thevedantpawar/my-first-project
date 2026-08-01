"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { signInWithCredentials } from "@/actions/auth";
import { mergeGuestCartAction } from "@/actions/cart";
import { useGuestCart } from "@/store/guest-cart";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const guestCart = useGuestCart();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);

    startTransition(async () => {
      const result = await signInWithCredentials({
        email: formData.get("email"),
        password: formData.get("password"),
        next,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Reconcile the localStorage cart into the database cart. Stock and
      // per-order limits are applied server-side during the merge.
      const guestItems = guestCart.items;
      if (guestItems.length > 0) {
        await mergeGuestCartAction({ items: guestItems });
        guestCart.clear();
      }

      router.push(result.data.redirectTo);
      router.refresh();
    });
  }

  return (
    <form action={submit} className="space-y-4">
      <label className="block text-sm text-ink-700">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-3 py-2.5 text-sm"
        />
      </label>

      <label className="block text-sm text-ink-700">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-3 py-2.5 text-sm"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-rx-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-5 py-3 text-sm font-semibold text-paper hover:bg-pine-900 disabled:bg-ink-100 disabled:text-ink-300"
      >
        {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        Sign in
      </button>
    </form>
  );
}
