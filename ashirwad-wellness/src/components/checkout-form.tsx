"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Plus, Tag, Truck, Wallet } from "lucide-react";

import { placeOrder } from "@/actions/checkout";
import { saveAddress, checkPincode } from "@/actions/addresses";
import { formatPaise } from "@/lib/money";
import { PaymentMethod } from "@/generated/prisma/enums";

type Address = {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

type PaymentOption = {
  method: PaymentMethod;
  available: boolean;
  reason?: string;
};

export function CheckoutForm({
  addresses,
  payments,
  totalPaise,
  couponCode,
  couponError,
}: {
  addresses: Address[];
  payments: PaymentOption[];
  totalPaise: number;
  couponCode: string | null;
  couponError: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [selectedAddressId, setSelectedAddressId] = useState(
    addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? "",
  );
  const firstAvailable = payments.find((p) => p.available)?.method;
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | undefined>(
    firstAvailable,
  );

  const [showAddressForm, setShowAddressForm] = useState(addresses.length === 0);
  const [coupon, setCoupon] = useState(couponCode ?? "");

  function submit() {
    setError(null);

    if (!selectedAddressId) {
      setError("Please choose a delivery address.");
      return;
    }
    if (!paymentMethod) {
      setError("Please choose a payment method.");
      return;
    }

    startTransition(async () => {
      const result = await placeOrder({
        addressId: selectedAddressId,
        paymentMethod,
        couponCode: coupon,
      });

      if (!result.ok) {
        setError(result.error);
        // The gate may have refused. Refresh so the cart reflects reality.
        router.refresh();
        return;
      }

      // Razorpay is not wired to a checkout widget in this phase; the order is
      // created and awaiting payment. Phase 6 attaches the browser SDK.
      router.push(`/order/${result.data.orderNumber}`);
    });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="address-heading">
        <h2 id="address-heading" className="flex items-center gap-2 text-base text-ink">
          <MapPin aria-hidden="true" className="size-4 text-pine-700" />
          Delivery address
        </h2>

        {addresses.length > 0 && (
          <ul className="mt-3 space-y-2">
            {addresses.map((address) => (
              <li key={address.id}>
                <label
                  className={`flex cursor-pointer gap-3 rounded-[var(--radius-card)] border p-3 ${
                    selectedAddressId === address.id
                      ? "border-living-500 bg-living-50"
                      : "border-ink-100 bg-paper-raised"
                  }`}
                >
                  <input
                    type="radio"
                    name="address"
                    checked={selectedAddressId === address.id}
                    onChange={() => setSelectedAddressId(address.id)}
                    className="mt-1 accent-pine-700"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-ink">
                      {address.fullName}
                      {address.isDefault && (
                        <span className="ml-2 rounded-full bg-pine-100 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-pine-700">
                          Default
                        </span>
                      )}
                    </span>
                    <span className="block text-ink-500">
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ""}
                      {address.landmark ? `, ${address.landmark}` : ""}
                    </span>
                    <span className="block text-ink-500">
                      {address.city}, {address.state}{" "}
                      <span className="identifier">{address.pincode}</span>
                    </span>
                    <span className="identifier block text-xs text-ink-300">
                      {address.phone}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {showAddressForm ? (
          <AddressForm
            onSaved={(id) => {
              setSelectedAddressId(id);
              setShowAddressForm(false);
              router.refresh();
            }}
            onCancel={addresses.length > 0 ? () => setShowAddressForm(false) : undefined}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAddressForm(true)}
            className="mt-3 flex items-center gap-1.5 text-sm text-living-600 hover:underline"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Add a new address
          </button>
        )}
      </section>

      <section aria-labelledby="coupon-heading">
        <h2 id="coupon-heading" className="flex items-center gap-2 text-base text-ink">
          <Tag aria-hidden="true" className="size-4 text-pine-700" />
          Coupon
        </h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const params = new URLSearchParams();
            if (coupon.trim()) params.set("coupon", coupon.trim());
            router.push(`/checkout?${params.toString()}`);
          }}
        >
          <input
            type="text"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            placeholder="Enter code"
            className="identifier min-w-0 flex-1 rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-3 py-2 text-sm uppercase"
          />
          <button
            type="submit"
            className="rounded-[var(--radius-control)] border border-pine-700 px-4 py-2 text-sm font-medium text-pine-700 hover:bg-pine-50"
          >
            Apply
          </button>
        </form>
        {couponError && (
          <p role="alert" className="mt-2 text-xs text-rx-700">
            {couponError}
          </p>
        )}
        <p className="mt-2 text-[0.6875rem] text-ink-300">
          Coupons do not apply to prescription medicines.
        </p>
      </section>

      <section aria-labelledby="payment-heading">
        <h2 id="payment-heading" className="flex items-center gap-2 text-base text-ink">
          <Wallet aria-hidden="true" className="size-4 text-pine-700" />
          Payment
        </h2>
        <ul className="mt-3 space-y-2">
          {payments.map((option) => (
            <li key={option.method}>
              <label
                className={`flex gap-3 rounded-[var(--radius-card)] border p-3 ${
                  !option.available
                    ? "cursor-not-allowed border-ink-100 bg-paper-sunk opacity-60"
                    : paymentMethod === option.method
                      ? "cursor-pointer border-living-500 bg-living-50"
                      : "cursor-pointer border-ink-100 bg-paper-raised"
                }`}
              >
                <input
                  type="radio"
                  name="payment"
                  disabled={!option.available}
                  checked={paymentMethod === option.method}
                  onChange={() => setPaymentMethod(option.method)}
                  className="mt-1 accent-pine-700"
                />
                <span className="text-sm">
                  <span className="block font-medium text-ink">
                    {option.method === PaymentMethod.COD
                      ? "Cash on delivery"
                      : "Pay online (UPI, card, netbanking)"}
                  </span>
                  {option.reason && (
                    <span className="block text-xs text-ink-500">{option.reason}</span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {error && (
        <div role="alert" className="rx-gate rounded-r-[var(--radius-control)] p-3">
          <p className="text-sm text-rx-700">{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending || !selectedAddressId || !paymentMethod}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-living-600 px-5 py-3.5 text-sm font-semibold text-paper hover:bg-living-700 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-300"
      >
        {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        Place order · {formatPaise(totalPaise)}
      </button>
    </div>
  );
}

function AddressForm({
  onSaved,
  onCancel,
}: {
  onSaved: (id: string) => void;
  onCancel?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pincodeState, setPincodeState] = useState<
    | { status: "idle" }
    | { status: "checking" }
    | { status: "ok"; city: string; state: string; etaHours: number }
    | { status: "no"; reason: string }
  >({ status: "idle" });

  // Serviceability is confirmed before the rest of the address is asked for.
  // Filling in a full address only to be told it cannot be delivered to is a
  // poor experience, and dispensing is genuinely limited to licensed premises.
  async function onPincodeBlur(value: string) {
    if (!/^[1-9][0-9]{5}$/.test(value)) return;
    setPincodeState({ status: "checking" });
    const result = await checkPincode(value);
    setPincodeState(
      result.serviceable
        ? {
            status: "ok",
            city: result.city,
            state: result.state,
            etaHours: result.etaHours,
          }
        : { status: "no", reason: result.reason },
    );
  }

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveAddress({
        fullName: formData.get("fullName"),
        phone: formData.get("phone"),
        line1: formData.get("line1"),
        line2: formData.get("line2"),
        landmark: formData.get("landmark"),
        city: formData.get("city"),
        state: formData.get("state"),
        pincode: formData.get("pincode"),
        isDefault: formData.get("isDefault") === "on",
      });

      if (result.ok) onSaved(result.data.id);
      else setError(result.error);
    });
  }

  const serviceable = pincodeState.status === "ok";

  return (
    <form
      action={submit}
      className="mt-3 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4"
    >
      <label className="block text-xs text-ink-700">
        Delivery pincode
        <input
          name="pincode"
          inputMode="numeric"
          maxLength={6}
          required
          onBlur={(e) => void onPincodeBlur(e.target.value)}
          className="identifier mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm sm:max-w-40"
        />
      </label>

      {pincodeState.status === "checking" && (
        <p className="mt-2 text-xs text-ink-500">Checking serviceability…</p>
      )}
      {pincodeState.status === "ok" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-living-600">
          <Truck aria-hidden="true" className="size-3.5" />
          Delivering to {pincodeState.city}, {pincodeState.state} — usually
          within {pincodeState.etaHours} hours.
        </p>
      )}
      {pincodeState.status === "no" && (
        <p role="alert" className="mt-2 text-xs text-rx-700">
          {pincodeState.reason}
        </p>
      )}

      <fieldset
        disabled={!serviceable}
        className="mt-4 grid gap-3 disabled:opacity-50 sm:grid-cols-2"
      >
        <label className="text-xs text-ink-700">
          Full name
          <input
            name="fullName"
            required
            className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-ink-700">
          Mobile number
          <input
            name="phone"
            inputMode="numeric"
            maxLength={10}
            required
            className="identifier mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-ink-700 sm:col-span-2">
          Flat, house number, building, street
          <input
            name="line1"
            required
            className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-ink-700 sm:col-span-2">
          Area, colony (optional)
          <input
            name="line2"
            className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-ink-700">
          Landmark (optional)
          <input
            name="landmark"
            className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-ink-700">
          City
          <input
            name="city"
            required
            defaultValue={pincodeState.status === "ok" ? pincodeState.city : ""}
            key={pincodeState.status === "ok" ? pincodeState.city : "city"}
            className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-ink-700">
          State
          <input
            name="state"
            required
            defaultValue={pincodeState.status === "ok" ? pincodeState.state : ""}
            key={pincodeState.status === "ok" ? pincodeState.state : "state"}
            className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-700 sm:col-span-2">
          <input name="isDefault" type="checkbox" className="accent-pine-700" />
          Make this my default address
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="mt-3 text-xs text-rx-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending || !serviceable}
          className="flex items-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-4 py-2 text-sm font-semibold text-paper hover:bg-pine-900 disabled:bg-ink-100 disabled:text-ink-300"
        >
          {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Save address
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-control)] border border-ink-100 px-4 py-2 text-sm text-ink-700"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
