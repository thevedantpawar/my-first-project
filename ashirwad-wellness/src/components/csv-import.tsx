"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";

import { importProductsCsv, type ImportRowError } from "@/actions/admin-products";

/**
 * Bulk CSV import.
 *
 * Every row goes through the same validation and compliance gates as a single
 * product save. Nothing is written unless the whole file passes — a
 * half-imported catalogue is harder to reason about than a rejected file, and
 * a partially-applied import of medicines is worse than no import.
 */
export function CsvImport() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<ImportRowError[]>([]);
  const [imported, setImported] = useState<number | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setRowErrors([]);
    setImported(null);

    startTransition(async () => {
      const result = await importProductsCsv(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.errors.length > 0) {
        setRowErrors(result.data.errors);
        return;
      }
      setImported(result.data.imported);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form action={submit} className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <label className="block text-sm text-ink-700">
          CSV file
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="mt-2 block w-full text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-pine-700 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="mt-4 flex items-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-4 py-2.5 text-sm font-semibold text-paper hover:bg-pine-900 disabled:bg-ink-100 disabled:text-ink-300"
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Upload aria-hidden="true" className="size-4" />
          )}
          Validate and import
        </button>
      </form>

      {error && (
        <div role="alert" className="rx-gate rounded-r-[var(--radius-control)] p-3">
          <p className="text-sm text-rx-700">{error}</p>
        </div>
      )}

      {imported !== null && (
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-living-500 bg-living-50 p-3">
          <CheckCircle2 aria-hidden="true" className="size-4 text-living-600" />
          <p className="text-sm text-living-600">
            Imported <span className="identifier font-semibold">{imported}</span>{" "}
            products.
          </p>
        </div>
      )}

      {rowErrors.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-rx-100 bg-rx-50 p-4">
          <p className="text-sm font-semibold text-rx-700">
            Nothing was imported. {rowErrors.length} row
            {rowErrors.length === 1 ? "" : "s"} failed validation.
          </p>
          <ul className="mt-2 space-y-1.5">
            {rowErrors.map((e) => (
              <li key={`${e.row}-${e.name}`} className="text-xs text-rx-700">
                <span className="identifier font-semibold">Row {e.row}</span> ·{" "}
                {e.name} — {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
