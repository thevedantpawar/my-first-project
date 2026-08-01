"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { X } from "lucide-react";

import { FORM_LABEL, SORT_LABEL } from "@/lib/labels";
import { formatPaiseCompact } from "@/lib/money";
import type { DosageForm } from "@/generated/prisma/enums";

/**
 * Filter rail.
 *
 * State lives entirely in the URL, so a filtered catalogue view is shareable,
 * bookmarkable, and survives a back button. The server reads the same params,
 * which means there is one source of truth rather than a client store that has
 * to be kept in sync with it.
 */

type Facets = {
  brands: { name: string; slug: string }[];
  forms: { form: DosageForm; count: number }[];
  rxCount: number;
  nonRxCount: number;
  minPricePaise: number;
  maxPricePaise: number;
};

const DISCOUNT_STEPS = [10, 20, 30, 40];

export function CatalogueFilters({ facets }: { facets: Facets }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      // Any filter change invalidates the current page number.
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const toggleMulti = (key: string, value: string) =>
    update((params) => {
      const current = params.getAll(key);
      params.delete(key);
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      next.forEach((v) => params.append(key, v));
    });

  const setSingle = (key: string, value: string | null) =>
    update((params) => {
      if (value === null) params.delete(key);
      else params.set(key, value);
    });

  const selectedBrands = searchParams.getAll("brand");
  const selectedForms = searchParams.getAll("form");
  const rx = searchParams.get("rx");
  const maxPrice = searchParams.get("maxPrice");
  const minDiscount = searchParams.get("minDiscount");
  const sort = searchParams.get("sort") ?? "relevance";

  const activeCount =
    selectedBrands.length +
    selectedForms.length +
    (rx ? 1 : 0) +
    (maxPrice ? 1 : 0) +
    (minDiscount ? 1 : 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="sort" className="text-sm font-semibold text-ink">
          Sort
        </label>
        <select
          id="sort"
          value={sort}
          onChange={(e) => setSingle("sort", e.target.value)}
          className="rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-2 py-1.5 text-sm text-ink"
        >
          {Object.entries(SORT_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => router.push(pathname, { scroll: false })}
          className="flex items-center gap-1.5 text-sm text-rx-700 hover:underline"
        >
          <X aria-hidden="true" className="size-3.5" />
          Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
        </button>
      )}

      {/* Prescription filter comes first — it is the most consequential
          distinction in a pharmacy catalogue, not just another facet. */}
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Prescription</legend>
        <div className="mt-2 space-y-1.5">
          {[
            { value: null, label: "All products", count: facets.rxCount + facets.nonRxCount },
            { value: "false", label: "No prescription needed", count: facets.nonRxCount },
            { value: "true", label: "Prescription required", count: facets.rxCount },
          ].map((option) => (
            <label
              key={option.label}
              className="flex cursor-pointer items-center gap-2 text-sm text-ink-700"
            >
              <input
                type="radio"
                name="rx"
                checked={(rx ?? null) === option.value}
                onChange={() => setSingle("rx", option.value)}
                className="accent-pine-700"
              />
              <span className={option.value === "true" ? "text-rx-700" : ""}>
                {option.value === "true" && (
                  <span aria-hidden="true" className="mr-1 font-bold">
                    ℞
                  </span>
                )}
                {option.label}
              </span>
              <span className="identifier ml-auto text-xs text-ink-300">
                {option.count}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {facets.brands.length > 0 && (
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Brand</legend>
          <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {facets.brands.map((brand) => (
              <label
                key={brand.slug}
                className="flex cursor-pointer items-center gap-2 text-sm text-ink-700"
              >
                <input
                  type="checkbox"
                  checked={selectedBrands.includes(brand.slug)}
                  onChange={() => toggleMulti("brand", brand.slug)}
                  className="accent-pine-700"
                />
                {brand.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {facets.forms.length > 0 && (
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Form</legend>
          <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {facets.forms.map(({ form, count }) => (
              <label
                key={form}
                className="flex cursor-pointer items-center gap-2 text-sm text-ink-700"
              >
                <input
                  type="checkbox"
                  checked={selectedForms.includes(form)}
                  onChange={() => toggleMulti("form", form)}
                  className="accent-pine-700"
                />
                {FORM_LABEL[form]}
                <span className="identifier ml-auto text-xs text-ink-300">
                  {count}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="text-sm font-semibold text-ink">
          Maximum price
        </legend>
        <div className="mt-2">
          <input
            type="range"
            min={facets.minPricePaise}
            max={facets.maxPricePaise}
            step={10000}
            value={maxPrice ? Number(maxPrice) : facets.maxPricePaise}
            onChange={(e) => setSingle("maxPrice", e.target.value)}
            className="w-full accent-living-500"
            aria-label="Maximum price"
          />
          <div className="mt-1 flex justify-between text-xs text-ink-500">
            <span className="identifier">
              {formatPaiseCompact(facets.minPricePaise)}
            </span>
            <span className="identifier font-semibold text-pine-700">
              up to{" "}
              {formatPaiseCompact(
                maxPrice ? Number(maxPrice) : facets.maxPricePaise,
              )}
            </span>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">Discount</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DISCOUNT_STEPS.map((step) => {
            const active = minDiscount === String(step);
            return (
              <button
                key={step}
                type="button"
                aria-pressed={active}
                onClick={() => setSingle("minDiscount", active ? null : String(step))}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  active
                    ? "border-turmeric-500 bg-turmeric-100 text-turmeric-600"
                    : "border-ink-100 text-ink-700 hover:border-turmeric-500"
                }`}
              >
                {step}% +
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
