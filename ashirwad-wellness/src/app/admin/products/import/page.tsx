import type { Metadata } from "next";

import { CsvImport } from "@/components/csv-import";

export const metadata: Metadata = {
  title: "Bulk import",
  robots: { index: false, follow: false },
};

const COLUMNS = [
  "name", "slug", "categorySlug", "manufacturerName", "brandName",
  "scheduleType", "composition", "strength", "form", "packSize",
  "hsnCode", "gstRateBps", "mrpPaise", "sellingPricePaise", "stock",
];

export default function ImportProductsPage() {
  return (
    <div className="max-w-3xl">
      <h2 className="text-base text-ink">Bulk product import</h2>
      <p className="mt-1 max-w-prose text-xs leading-relaxed text-ink-500">
        Each row runs through exactly the same validation as a single product
        save, including the banned-substance check and the therapeutic-claim
        linter. A bulk path that skipped those would be the obvious way to get a
        controlled substance into the catalogue, so it does not exist.
      </p>
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-500">
        If any row fails, nothing is written. Fix the file and try again.
      </p>

      <div className="mt-4 rounded-[var(--radius-control)] bg-paper-sunk p-3">
        <p className="text-xs font-semibold text-ink">Required columns</p>
        <p className="identifier mt-1 break-words text-[0.6875rem] text-ink-500">
          {COLUMNS.join(",")}
        </p>
        <p className="mt-2 text-[0.625rem] text-ink-300">
          Money in paise. <span className="identifier">gstRateBps</span>: 0, 500,
          1200, 1800 or 2800. <span className="identifier">brandName</span> is
          optional. Quoted commas are not supported — a row needing them is
          rejected rather than silently mangled.
        </p>
      </div>

      <div className="mt-5">
        <CsvImport />
      </div>
    </div>
  );
}
