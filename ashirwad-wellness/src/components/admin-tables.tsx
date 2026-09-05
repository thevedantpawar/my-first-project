"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  updateOrderStatus,
  toggleServiceablePincode,
  saveServiceablePincode,
  toggleCoupon,
  saveInventoryBatch,
  setPharmacistRegNo,
} from "@/actions/admin";
import { OrderStatus } from "@/generated/prisma/enums";

/** Shared inline-action wrapper: run, show the error, refresh on success. */
function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) router.refresh();
      else setError(result.error ?? "Something went wrong.");
    });
  };

  return { run, pending, error };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-1 text-[0.6875rem] text-rx-700">
      {error}
    </p>
  );
}

/**
 * Order status control.
 *
 * The options offered come from the server-side transition table, so an
 * administrator is never shown a move that would be refused — and an order
 * awaiting pharmacist review offers nothing at all, because releasing it is a
 * dispensing decision.
 */
export function OrderStatusControl({
  orderId,
  current,
  allowed,
}: {
  orderId: string;
  current: OrderStatus;
  allowed: OrderStatus[];
}) {
  const { run, pending, error } = useAction();

  if (current === OrderStatus.PENDING_PHARMACIST_REVIEW) {
    return (
      <span className="text-[0.6875rem] text-rx-700">
        Pharmacist decision required
      </span>
    );
  }

  if (allowed.length === 0) {
    return <span className="text-[0.6875rem] text-ink-300">No further steps</span>;
  }

  return (
    <div>
      <select
        aria-label="Change order status"
        disabled={pending}
        defaultValue=""
        onChange={(e) => {
          if (!e.target.value) return;
          const toStatus = e.target.value as OrderStatus;
          const note =
            toStatus === OrderStatus.CANCELLED
              ? (window.prompt("Reason for cancelling?") ?? "")
              : "";
          run(() => updateOrderStatus({ orderId, toStatus, note }));
        }}
        className="rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-2 py-1 text-xs"
      >
        <option value="">Move to…</option>
        {allowed.map((s) => (
          <option key={s} value={s}>
            {s.toLowerCase().replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <ErrorLine error={error} />
    </div>
  );
}

export function PincodeToggle({
  pincode,
  isActive,
}: {
  pincode: string;
  isActive: boolean;
}) {
  const { run, pending, error } = useAction();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => toggleServiceablePincode({ pincode, isActive: !isActive }))}
        className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${
          isActive
            ? "bg-living-100 text-living-600"
            : "bg-ink-100 text-ink-500"
        }`}
      >
        {pending ? "…" : isActive ? "Serviceable" : "Disabled"}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

export function AddPincodeForm() {
  const { run, pending, error } = useAction();

  return (
    <form
      action={(formData) =>
        run(() =>
          saveServiceablePincode({
            pincode: formData.get("pincode"),
            city: formData.get("city"),
            state: formData.get("state") || "Maharashtra",
            etaHours: formData.get("etaHours") || 48,
            codAvailable: formData.get("codAvailable") === "on",
            isActive: true,
          }),
        )
      }
      className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4"
    >
      <h3 className="text-sm font-semibold text-ink">Add a serviceable pincode</h3>
      <p className="mt-1 text-xs text-ink-500">
        Delivery is allow-list only — a pincode not listed here is not
        serviceable, because dispensing is tied to licensed premises.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <input name="pincode" required maxLength={6} placeholder="422001" className="identifier rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm" />
        <input name="city" required placeholder="Nashik" className="rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm" />
        <input name="state" defaultValue="Maharashtra" className="rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm" />
        <input name="etaHours" type="number" min={1} defaultValue={48} className="identifier rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm" />
      </div>

      <label className="mt-2 flex items-center gap-2 text-xs text-ink-700">
        <input name="codAvailable" type="checkbox" defaultChecked className="accent-pine-700" />
        Cash on delivery available
      </label>

      <ErrorLine error={error} />

      <button
        type="submit"
        disabled={pending}
        className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-4 py-2 text-sm font-semibold text-paper disabled:bg-ink-100"
      >
        {pending && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
        Add pincode
      </button>
    </form>
  );
}

export function CouponToggle({ code, isActive }: { code: string; isActive: boolean }) {
  const { run, pending, error } = useAction();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => toggleCoupon({ code, isActive: !isActive }))}
        className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${
          isActive ? "bg-living-100 text-living-600" : "bg-ink-100 text-ink-500"
        }`}
      >
        {pending ? "…" : isActive ? "Active" : "Paused"}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

export function AddBatchForm({
  products,
}: {
  products: { id: string; name: string }[];
}) {
  const { run, pending, error } = useAction();

  return (
    <form
      action={(formData) =>
        run(() =>
          saveInventoryBatch({
            productId: formData.get("productId"),
            batchNumber: formData.get("batchNumber"),
            expiryDate: formData.get("expiryDate"),
            quantity: formData.get("quantity"),
            costPaise: formData.get("costPaise") || undefined,
          }),
        )
      }
      className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4"
    >
      <h3 className="text-sm font-semibold text-ink">Record a stock batch</h3>
      <p className="mt-1 text-xs text-ink-500">
        Batch and expiry are what the pharmacist selects when dispensing a
        Schedule H1 item, and what gets written into the statutory register. An
        already-expired batch is refused.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select name="productId" required className="rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm lg:col-span-2">
          <option value="">— choose a product —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input name="batchNumber" required placeholder="Batch no." className="identifier rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm" />
        <input name="expiryDate" type="date" required className="identifier rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm" />
        <input name="quantity" type="number" min={0} required placeholder="Qty" className="identifier rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm" />
        <input name="costPaise" type="number" min={0} placeholder="Cost (paise)" className="identifier rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm" />
      </div>

      <ErrorLine error={error} />

      <button
        type="submit"
        disabled={pending}
        className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-4 py-2 text-sm font-semibold text-paper disabled:bg-ink-100"
      >
        {pending && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
        Save batch
      </button>
    </form>
  );
}

export function RegNoEditor({
  userId,
  current,
}: {
  userId: string;
  current: string | null;
}) {
  const { run, pending, error } = useAction();
  const [value, setValue] = useState(current ?? "");

  return (
    <div>
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="MSPC registration no."
          aria-label="Pharmacist registration number"
          className="identifier w-48 rounded-[var(--radius-control)] border border-ink-100 px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={pending || value === (current ?? "")}
          onClick={() => run(() => setPharmacistRegNo({ userId, pharmacistRegNo: value }))}
          className="rounded-[var(--radius-control)] bg-pine-700 px-2.5 py-1 text-xs font-semibold text-paper disabled:bg-ink-100 disabled:text-ink-300"
        >
          {pending ? "…" : "Save"}
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}
