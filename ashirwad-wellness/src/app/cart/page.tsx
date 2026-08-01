import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck, ArrowRight, AlertTriangle } from "lucide-react";

import { auth } from "@/auth";
import { getCartView } from "@/lib/cart";
import { getUsablePrescriptions } from "@/lib/rx-gate";
import { CartLine } from "@/components/cart-line";
import { PrescriptionUpload } from "@/components/prescription-upload";
import { formatPaise } from "@/lib/money";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/cart");

  const [cart, prescriptions] = await Promise.all([
    getCartView(session.user.id),
    getUsablePrescriptions(session.user.id),
  ]);

  if (cart.isEmpty) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl text-ink">Your cart is empty</h1>
        <p className="mt-2 text-sm text-ink-500">
          Browse the catalogue to get started.
        </p>
        <Link
          href="/category/medicines"
          className="mt-6 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-living-600 px-5 py-2.5 text-sm font-semibold text-paper hover:bg-living-700"
        >
          Browse medicines
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    );
  }

  const { totals, gate } = cart;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-2xl text-ink">Your cart</h1>
      <p className="mt-1 text-sm text-ink-500">
        <span className="identifier">{cart.itemCount}</span>{" "}
        {cart.itemCount === 1 ? "item" : "items"}
      </p>

      <div className="mt-6 gap-8 lg:grid lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-8">
          {/* Rx and non-Rx lines are separated rather than interleaved, so the
              part of the order that needs a pharmacist is unmistakable. */}
          {cart.rxItems.length > 0 && (
            <section aria-labelledby="rx-items-heading">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id="rx-items-heading" className="text-base text-ink">
                  Prescription medicines
                </h2>
                <span className="identifier text-xs text-rx-700">
                  {cart.rxItems.length} of {cart.items.length}
                </span>
              </div>

              <ul className="space-y-3">
                {cart.rxItems.map((item) => (
                  <CartLine
                    key={item.id}
                    item={item}
                    violation={gate.byProductId.get(item.product.id)}
                    prescriptions={prescriptions}
                  />
                ))}
              </ul>

              <div className="mt-4 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
                <h3 className="text-sm font-semibold text-ink">
                  Upload a prescription
                </h3>
                <p className="mt-1 text-xs text-ink-500">
                  A registered pharmacist reviews every prescription before
                  anything is dispensed. Once verified, attach it to the items
                  above.
                </p>
                <div className="mt-3">
                  <PrescriptionUpload />
                </div>
              </div>
            </section>
          )}

          {cart.otcItems.length > 0 && (
            <section aria-labelledby="otc-items-heading">
              <h2 id="otc-items-heading" className="mb-3 text-base text-ink">
                {cart.rxItems.length > 0
                  ? "Other items — no prescription needed"
                  : "Your items"}
              </h2>
              <ul className="space-y-3">
                {cart.otcItems.map((item) => (
                  <CartLine
                    key={item.id}
                    item={item}
                    violation={gate.byProductId.get(item.product.id)}
                    prescriptions={prescriptions}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="mt-8 lg:mt-0 lg:sticky lg:top-32 lg:self-start">
          <div className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
            <h2 className="text-base text-ink">Order summary</h2>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Subtotal (MRP)</dt>
                <dd className="identifier text-ink-700">
                  {formatPaise(totals.subtotalPaise + totals.savingsPaise)}
                </dd>
              </div>
              {totals.savingsPaise > 0 && (
                <div className="flex justify-between">
                  <dt className="text-savings">Discount on MRP</dt>
                  <dd className="identifier text-savings">
                    −{formatPaise(totals.savingsPaise)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-500">Delivery</dt>
                <dd className="identifier text-ink-700">
                  {totals.deliveryPaise === 0
                    ? "Free"
                    : formatPaise(totals.deliveryPaise)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold">
                <dt className="text-ink">Total</dt>
                <dd className="identifier text-pine-700">
                  {formatPaise(totals.totalPaise)}
                </dd>
              </div>
              <p className="text-[0.6875rem] text-ink-300">
                Inclusive of GST ({formatPaise(totals.gstPaise)})
              </p>
            </dl>

            {totals.savingsPaise > 0 && (
              <p className="mt-3 rounded-[var(--radius-control)] bg-turmeric-50 p-2 text-center text-xs font-semibold text-turmeric-600">
                You save {formatPaise(totals.savingsPaise)} on this order
              </p>
            )}

            {cart.outOfStock.length > 0 && (
              <div className="mt-4 flex gap-2 rounded-[var(--radius-control)] border border-turmeric-500/40 bg-turmeric-50 p-3">
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-turmeric-600"
                />
                <p className="text-xs text-ink-700">
                  Some items no longer have enough stock. Adjust the quantities
                  to continue.
                </p>
              </div>
            )}

            {/* The gate preview. Advisory here — checkout re-runs it. */}
            {!gate.satisfied && (
              <div className="rx-gate mt-4 rounded-r-[var(--radius-control)] p-3">
                <p className="text-xs font-semibold text-rx-700">
                  Prescription needed before checkout
                </p>
                <ul className="mt-1.5 space-y-1">
                  {gate.violations.map((v) => (
                    <li key={v.productId} className="text-[0.6875rem] text-rx-700">
                      <strong className="font-semibold">{v.productName}</strong> —{" "}
                      {v.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link
              href="/checkout"
              aria-disabled={!gate.satisfied || cart.outOfStock.length > 0}
              className={`mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-5 py-3 text-sm font-semibold ${
                gate.satisfied && cart.outOfStock.length === 0
                  ? "bg-living-600 text-paper hover:bg-living-700"
                  : "pointer-events-none bg-ink-100 text-ink-300"
              }`}
            >
              Proceed to checkout
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>

            <p className="mt-3 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-ink-500">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 text-living-600"
              />
              Dispensed by a licensed pharmacy in Nashik. Prescription
              medicines are checked by a registered pharmacist before dispatch.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
