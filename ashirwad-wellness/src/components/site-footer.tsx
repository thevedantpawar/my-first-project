import { pharmacy, unconfiguredRegulatoryFields } from "@/lib/pharmacy";

/**
 * Statutory disclosure block.
 *
 * Rule 65 of the Drugs and Cosmetics Rules requires the licence details of the
 * dispensing premises and the registered pharmacist to be displayed. This
 * component renders on every page and on the checkout page.
 *
 * Placeholder values are rendered visibly as unconfigured rather than hidden.
 * A footer that quietly omits a missing drug licence number is worse than one
 * that says it is missing.
 */

function Identifier({ label, value }: { label: string; value: string }) {
  const unset = value.startsWith("REPLACE_ME");

  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.6875rem] uppercase tracking-wide text-pine-100/70">
        {label}
      </dt>
      <dd
        className={
          unset
            ? "identifier text-xs text-turmeric-500"
            : "identifier text-xs text-paper"
        }
      >
        {unset ? "Not configured" : value}
      </dd>
    </div>
  );
}

export function SiteFooter() {
  const missing = unconfiguredRegulatoryFields();

  return (
    <footer className="mt-16 bg-pine-700 text-paper">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <h2 className="font-display text-lg text-paper">
          {pharmacy.tradeName}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-pine-100">
          A licensed retail pharmacy dispensing from registered premises in
          Nashik, Maharashtra. Prescription medicines are dispensed only after
          verification by a registered pharmacist.
        </p>

        <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Identifier
            label="Drug Licence (Form 20B)"
            value={pharmacy.drugLicence20B}
          />
          <Identifier
            label="Drug Licence (Form 21B)"
            value={pharmacy.drugLicence21B}
          />
          <Identifier label="FSSAI Licence" value={pharmacy.fssaiLicence} />
          <Identifier label="GSTIN" value={pharmacy.gstin} />
          <Identifier
            label="Registered Pharmacist"
            value={pharmacy.pharmacistName}
          />
          <Identifier
            label={`Registration No. (${pharmacy.pharmacistCouncil})`}
            value={pharmacy.pharmacistRegNo}
          />
        </dl>

        {missing.length > 0 && (
          <p className="mt-8 rounded-[var(--radius-control)] border border-turmeric-500/40 bg-turmeric-500/10 p-3 text-xs text-turmeric-100">
            <strong className="font-semibold">
              {missing.length} statutory identifier
              {missing.length === 1 ? "" : "s"} not yet configured.
            </strong>{" "}
            This deployment is not ready to accept customer orders. Set the
            values listed in <code className="identifier">.env.example</code>.
          </p>
        )}

        <p className="mt-8 border-t border-pine-500/40 pt-6 text-xs leading-relaxed text-pine-100">
          Information on this site is for general reference and does not replace
          advice from a qualified medical practitioner. Self-medication can be
          harmful. Always read the label and consult your doctor or pharmacist.
        </p>
      </div>
    </footer>
  );
}
