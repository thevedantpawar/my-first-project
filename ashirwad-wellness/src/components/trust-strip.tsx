import { ShieldCheck, Stethoscope, Truck, FileCheck } from "lucide-react";

import { pharmacy } from "@/lib/pharmacy";

/**
 * Trust strip — licence numbers where a customer will actually look, rather
 * than only in the footer.
 *
 * Unconfigured identifiers render as "Not configured" instead of being hidden,
 * for the same reason as the footer: a missing drug licence number should be
 * conspicuous, not quietly absent.
 */

function Value({ value }: { value: string }) {
  const unset = value.startsWith("REPLACE_ME");
  return (
    <span
      className={`identifier block text-xs ${unset ? "text-turmeric-600" : "text-ink-700"}`}
    >
      {unset ? "Not configured" : value}
    </span>
  );
}

export function TrustStrip() {
  const items = [
    {
      icon: ShieldCheck,
      label: "Drug Licence (Form 20B)",
      value: pharmacy.drugLicence20B,
    },
    {
      icon: FileCheck,
      label: "FSSAI Licence",
      value: pharmacy.fssaiLicence,
    },
    {
      icon: Stethoscope,
      label: "Registered Pharmacist",
      value: pharmacy.pharmacistRegNo,
    },
  ];

  return (
    <section
      aria-label="Licensing and delivery"
      className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4 shadow-[var(--shadow-card)]"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-2.5">
            <item.icon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-living-600"
            />
            <div className="min-w-0">
              <p className="text-[0.6875rem] uppercase tracking-wide text-ink-300">
                {item.label}
              </p>
              <Value value={item.value} />
            </div>
          </div>
        ))}

        <div className="flex items-start gap-2.5">
          <Truck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-living-600"
          />
          <div className="min-w-0">
            <p className="text-[0.6875rem] uppercase tracking-wide text-ink-300">
              Delivery area
            </p>
            <span className="block text-xs text-ink-700">
              Nashik district only
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
