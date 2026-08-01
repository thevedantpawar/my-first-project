"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Trash2, Loader2, Link2 } from "lucide-react";

import {
  updateCartQuantity,
  removeFromCart,
  linkPrescriptionToItem,
} from "@/actions/cart";
import { formatPaise, savingsPaise } from "@/lib/money";
import { RX_GATE_COPY } from "@/lib/schedule";
import { ProductImage } from "./product-image";
import { RxBadge } from "./rx-gate";
import type { RxGateViolation } from "@/lib/rx-gate";

export type UsablePrescription = {
  id: string;
  doctorName: string | null;
  verifiedAt: Date | null;
  validUntil: Date | null;
  dispensingsLeft: number;
  patient: { fullName: string } | null;
};

/**
 * Cart line — the third of the four Rx Gate surfaces.
 *
 * A prescription item carries the same left rule, the same tint, the same ℞
 * chip and the same wording as it does on the catalogue card and the product
 * page. What is added here is the consequence: which prescription is attached,
 * and what is blocking checkout if anything.
 */
export function CartLine({
  item,
  violation,
  prescriptions,
}: {
  item: {
    id: string;
    quantity: number;
    prescriptionId: string | null;
    product: {
      id: string;
      name: string;
      nameHi: string | null;
      slug: string;
      images: string[];
      composition: string;
      packSize: string;
      requiresPrescription: boolean;
      mrpPaise: number;
      sellingPricePaise: number;
      stock: number;
      maxPerOrder: number;
    };
  };
  violation?: RxGateViolation;
  prescriptions: UsablePrescription[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isRx = item.product.requiresPrescription;
  const lineTotal = item.product.sellingPricePaise * item.quantity;
  const saved = savingsPaise(item.product.mrpPaise, item.product.sellingPricePaise) * item.quantity;
  const maxQuantity = Math.min(item.product.maxPerOrder, item.product.stock);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else router.refresh();
    });
  }

  return (
    <li
      className={`rounded-[var(--radius-card)] border border-ink-100 p-3 sm:p-4 ${
        isRx ? "rx-gate" : "bg-paper-raised"
      }`}
    >
      <div className="flex gap-3 sm:gap-4">
        <div className="size-20 shrink-0 overflow-hidden rounded-[var(--radius-control)] border border-ink-100 bg-paper-sunk sm:size-24">
          <ProductImage
            src={item.product.images[0]}
            name={item.product.name}
            slug={item.product.slug}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-ink">
                <Link href={`/product/${item.product.slug}`} className="hover:underline">
                  {item.product.name}
                </Link>
              </h3>
              {item.product.nameHi && (
                <p className="font-devanagari text-xs text-ink-500">
                  {item.product.nameHi}
                </p>
              )}
              <p className="mt-0.5 text-xs text-ink-500">{item.product.composition}</p>
              <p className="text-[0.6875rem] text-ink-300">{item.product.packSize}</p>
            </div>
            {isRx && <RxBadge />}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised">
              <button
                type="button"
                aria-label={`Decrease quantity of ${item.product.name}`}
                disabled={pending}
                onClick={() =>
                  run(() =>
                    updateCartQuantity({
                      cartItemId: item.id,
                      quantity: item.quantity - 1,
                    }),
                  )
                }
                className="grid size-8 place-items-center text-ink-700 hover:bg-pine-50 disabled:opacity-40"
              >
                <Minus aria-hidden="true" className="size-3.5" />
              </button>
              <span className="identifier min-w-8 text-center text-sm" aria-live="polite">
                {pending ? (
                  <Loader2 aria-hidden="true" className="mx-auto size-3.5 animate-spin" />
                ) : (
                  item.quantity
                )}
              </span>
              <button
                type="button"
                aria-label={`Increase quantity of ${item.product.name}`}
                disabled={pending || item.quantity >= maxQuantity}
                onClick={() =>
                  run(() =>
                    updateCartQuantity({
                      cartItemId: item.id,
                      quantity: item.quantity + 1,
                    }),
                  )
                }
                className="grid size-8 place-items-center text-ink-700 hover:bg-pine-50 disabled:opacity-40"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
            </div>

            <div className="text-right">
              <p className="identifier text-sm font-semibold text-pine-700">
                {formatPaise(lineTotal)}
              </p>
              {saved > 0 && (
                <p className="text-[0.6875rem] text-savings">
                  Saving {formatPaise(saved)}
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => removeFromCart({ cartItemId: item.id }))}
              className="flex items-center gap-1 text-xs text-ink-500 hover:text-rx-700"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              Remove
            </button>
          </div>
        </div>
      </div>

      {isRx && (
        <div className="mt-3 border-t border-rx-100 pt-3">
          <label
            htmlFor={`rx-${item.id}`}
            className="flex items-center gap-1.5 text-xs font-medium text-rx-700"
          >
            <Link2 aria-hidden="true" className="size-3.5" />
            Prescription for this item
          </label>

          <select
            id={`rx-${item.id}`}
            disabled={pending}
            value={item.prescriptionId ?? ""}
            onChange={(e) =>
              run(() =>
                linkPrescriptionToItem({
                  cartItemId: item.id,
                  prescriptionId: e.target.value || null,
                }),
              )
            }
            className="mt-1.5 w-full rounded-[var(--radius-control)] border border-rx-100 bg-paper-raised px-2.5 py-2 text-sm text-ink"
          >
            <option value="">Not attached yet</option>
            {prescriptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.patient?.fullName ?? "Self"}
                {p.doctorName ? ` · ${p.doctorName}` : ""}
                {p.validUntil
                  ? ` · valid to ${p.validUntil.toLocaleDateString("en-IN")}`
                  : ""}
                {` · ${p.dispensingsLeft} supply${p.dispensingsLeft === 1 ? "" : " left"}`}
              </option>
            ))}
          </select>

          <p className="mt-2 text-[0.6875rem] leading-relaxed text-rx-700">
            {violation ? violation.message : RX_GATE_COPY.cartNotice}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-rx-700">
          {error}
        </p>
      )}
    </li>
  );
}
