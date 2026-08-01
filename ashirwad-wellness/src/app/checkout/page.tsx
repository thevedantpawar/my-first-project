import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getCartView } from "@/lib/cart";
import { availablePaymentMethods } from "@/lib/pricing";
import { COUPON_FAILURE_MESSAGE } from "@/lib/pricing";
import { CheckoutForm } from "@/components/checkout-form";
import { formatPaise } from "@/lib/money";
import { RX_GATE_COPY } from "@/lib/schedule";
import { RxBadge } from "@/components/rx-gate";
import { pharmacy } from "@/lib/pharmacy";
import type { RawSearchParams } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/checkout");

  const params = await searchParams;
  const couponCode = typeof params.coupon === "string" ? params.coupon : null;

  const [cart, addresses] = await Promise.all([
    getCartView(session.user.id, couponCode),
    db.address.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  if (cart.isEmpty) redirect("/cart");

  // Belt and braces: the gate blocks the order anyway, but sending a customer
  // to a payment screen they cannot complete is a poor experience.
  if (!cart.gate.satisfied) redirect("/cart");

  const { totals } = cart;
  const payments = availablePaymentMethods(totals.totalPaise);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-2xl text-ink">Checkout</h1>

      <div className="mt-6 gap-8 lg:grid lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <CheckoutForm
            addresses={addresses}
            payments={payments}
            totalPaise={totals.totalPaise}
            couponCode={couponCode}
            couponError={
              totals.couponError ? COUPON_FAILURE_MESSAGE[totals.couponError] : null
            }
          />
        </div>

        <aside className="mt-8 lg:mt-0 lg:sticky lg:top-32 lg:self-start">
          <div className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
            <h2 className="text-base text-ink">Order summary</h2>

            <ul className="mt-3 space-y-2.5 border-b border-ink-100 pb-3">
              {cart.items.map((item) => (
                <li
                  key={item.id}
                  className={`flex gap-2 text-xs ${
                    item.product.requiresPrescription
                      ? "rx-gate rounded-r-[var(--radius-control)] p-2"
                      : ""
                  }`}
                >
                  <span className="identifier shrink-0 text-ink-300">
                    {item.quantity}×
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink-700">
                      {item.product.name}
                    </span>
                    {item.product.requiresPrescription && (
                      <span className="mt-1 inline-block">
                        <RxBadge variant="quiet" />
                      </span>
                    )}
                  </span>
                  <span className="identifier shrink-0 text-ink-700">
                    {formatPaise(item.product.sellingPricePaise * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Subtotal</dt>
                <dd className="identifier text-ink-700">
                  {formatPaise(totals.subtotalPaise)}
                </dd>
              </div>
              {totals.coupon && (
                <div className="flex justify-between">
                  <dt className="text-savings">
                    Coupon <span className="identifier">{totals.coupon.code}</span>
                  </dt>
                  <dd className="identifier text-savings">
                    −{formatPaise(totals.discountPaise)}
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

            {totals.containsRxItems && (
              <div className="rx-gate mt-4 rounded-r-[var(--radius-control)] p-3">
                <p className="text-xs leading-relaxed text-rx-700">
                  <strong className="font-semibold">
                    Pharmacist review required.
                  </strong>{" "}
                  {RX_GATE_COPY.long}
                </p>
              </div>
            )}
          </div>

          {/* Statutory disclosure on the checkout page, per Rule 65. */}
          <div className="mt-4 rounded-[var(--radius-card)] border border-ink-100 bg-paper-sunk p-3">
            <h2 className="text-xs font-semibold text-ink">
              Dispensed by {pharmacy.tradeName}
            </h2>
            <dl className="mt-2 space-y-1 text-[0.6875rem]">
              {[
                ["Drug Licence (20B)", pharmacy.drugLicence20B],
                ["Drug Licence (21B)", pharmacy.drugLicence21B],
                ["FSSAI", pharmacy.fssaiLicence],
                ["Pharmacist", pharmacy.pharmacistName],
                ["Registration", pharmacy.pharmacistRegNo],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt className="text-ink-500">{label}</dt>
                  <dd
                    className={`identifier text-right ${
                      value.startsWith("REPLACE_ME")
                        ? "text-turmeric-600"
                        : "text-ink-700"
                    }`}
                  >
                    {value.startsWith("REPLACE_ME") ? "Not configured" : value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[0.625rem] leading-relaxed text-ink-300">
              By placing this order you confirm the prescription details are
              accurate.{" "}
              <Link href="/cart" className="underline">
                Back to cart
              </Link>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
