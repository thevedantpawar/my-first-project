"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";

import { saveProduct, delistProduct } from "@/actions/admin-products";
import { ScheduleType, DosageForm } from "@/generated/prisma/enums";
import { SCHEDULE_LABEL, requiresPrescription } from "@/lib/schedule";
import { FORM_LABEL } from "@/lib/labels";

type Options = {
  categories: { id: string; name: string }[];
  manufacturers: { id: string; name: string }[];
  brands: { id: string; name: string }[];
};

type Existing = {
  id: string;
  name: string;
  nameHi: string | null;
  slug: string;
  brandId: string | null;
  categoryId: string;
  manufacturerId: string;
  scheduleType: ScheduleType;
  composition: string;
  strength: string | null;
  form: DosageForm;
  packSize: string;
  hsnCode: string;
  gstRateBps: number;
  mrpPaise: number;
  sellingPricePaise: number;
  stock: number;
  maxPerOrder: number;
  shortDescription: string | null;
  uses: string | null;
  howItWorks: string | null;
  directions: string | null;
  sideEffects: string | null;
  warnings: string | null;
  storage: string | null;
  isActive: boolean;
  isRefrigerated: boolean;
};

const GST_OPTIONS = [
  { value: 0, label: "0%" },
  { value: 500, label: "5%" },
  { value: 1200, label: "12%" },
  { value: 1800, label: "18%" },
  { value: 2800, label: "28%" },
];

export function ProductForm({
  options,
  existing,
}: {
  options: Options;
  existing?: Existing;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    existing?.scheduleType ?? ScheduleType.OTC,
  );

  // Shown live so the admin sees the consequence of the schedule type before
  // saving. The value itself is derived server-side regardless of this.
  const willRequireRx = requiresPrescription(scheduleType);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveProduct({
        id: existing?.id,
        name: formData.get("name"),
        nameHi: formData.get("nameHi"),
        slug: formData.get("slug"),
        brandId: formData.get("brandId"),
        categoryId: formData.get("categoryId"),
        manufacturerId: formData.get("manufacturerId"),
        scheduleType: formData.get("scheduleType"),
        composition: formData.get("composition"),
        strength: formData.get("strength"),
        form: formData.get("form"),
        packSize: formData.get("packSize"),
        hsnCode: formData.get("hsnCode"),
        gstRateBps: formData.get("gstRateBps"),
        mrpPaise: formData.get("mrpPaise"),
        sellingPricePaise: formData.get("sellingPricePaise"),
        stock: formData.get("stock"),
        maxPerOrder: formData.get("maxPerOrder"),
        shortDescription: formData.get("shortDescription"),
        uses: formData.get("uses"),
        howItWorks: formData.get("howItWorks"),
        directions: formData.get("directions"),
        sideEffects: formData.get("sideEffects"),
        warnings: formData.get("warnings"),
        storage: formData.get("storage"),
        isActive: formData.get("isActive") === "on",
        isRefrigerated: formData.get("isRefrigerated") === "on",
      });

      if (result.ok) router.push("/admin/products");
      else setError(result.error);
    });
  }

  function onDelist() {
    const reason = window.prompt("Why is this product being delisted?");
    if (!reason) return;

    startTransition(async () => {
      const result = await delistProduct({ productId: existing!.id, reason });
      if (result.ok) router.push("/admin/products");
      else setError(result.error);
    });
  }

  const field =
    "mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-2.5 py-2 text-sm";

  return (
    <form action={submit} className="space-y-6">
      <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Classification</h2>
        <p className="mt-1 text-xs text-ink-500">
          The schedule type determines whether a prescription is required. That
          value is derived, never typed — and Schedule X, narcotics and
          psychotropics have no option here by design.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-ink-700">
            Schedule type
            <select
              name="scheduleType"
              value={scheduleType}
              onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
              className={field}
            >
              {Object.values(ScheduleType).map((s) => (
                <option key={s} value={s}>
                  {SCHEDULE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <div className="text-xs text-ink-700">
            Prescription required
            <div
              className={`mt-1 flex items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-sm ${
                willRequireRx
                  ? "bg-rx-50 text-rx-700"
                  : "bg-living-50 text-living-600"
              }`}
            >
              {willRequireRx && <ShieldAlert aria-hidden="true" className="size-3.5" />}
              {willRequireRx ? "Yes — Rx gated" : "No"}
            </div>
            <p className="mt-1 text-[0.625rem] text-ink-300">
              Derived from the schedule type and enforced by a database
              constraint.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Identity</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-ink-700">
            Name
            <input name="name" required defaultValue={existing?.name} className={field} />
          </label>
          <label className="text-xs text-ink-700">
            Name (Devanagari)
            <input name="nameHi" defaultValue={existing?.nameHi ?? ""} className={`${field} font-devanagari`} />
          </label>
          <label className="text-xs text-ink-700">
            Slug
            <input name="slug" required defaultValue={existing?.slug} className={`${field} identifier`} />
          </label>
          <label className="text-xs text-ink-700">
            Brand
            <select name="brandId" defaultValue={existing?.brandId ?? ""} className={field}>
              <option value="">— none —</option>
              {options.brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-700">
            Category
            <select name="categoryId" required defaultValue={existing?.categoryId} className={field}>
              <option value="">— choose —</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-700">
            Manufacturer
            <select name="manufacturerId" required defaultValue={existing?.manufacturerId} className={field}>
              <option value="">— choose —</option>
              {options.manufacturers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-700 sm:col-span-2">
            Composition
            <input name="composition" required defaultValue={existing?.composition} className={field} />
          </label>
          <label className="text-xs text-ink-700">
            Strength
            <input name="strength" defaultValue={existing?.strength ?? ""} className={field} />
          </label>
          <label className="text-xs text-ink-700">
            Dosage form
            <select name="form" required defaultValue={existing?.form ?? DosageForm.TABLET} className={field}>
              {Object.values(DosageForm).map((f) => (
                <option key={f} value={f}>{FORM_LABEL[f]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-700">
            Pack size
            <input name="packSize" required defaultValue={existing?.packSize} className={field} />
          </label>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Pricing and tax</h2>
        <p className="mt-1 text-xs text-ink-500">
          All money in paise. MRP is inclusive of GST.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-ink-700">
            HSN code
            <input name="hsnCode" required defaultValue={existing?.hsnCode} className={`${field} identifier`} />
          </label>
          <label className="text-xs text-ink-700">
            GST slab
            <select name="gstRateBps" required defaultValue={existing?.gstRateBps ?? 1200} className={field}>
              {GST_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-700">
            Max per order
            <input name="maxPerOrder" type="number" min={1} max={100} required defaultValue={existing?.maxPerOrder ?? 10} className={`${field} identifier`} />
          </label>
          <label className="text-xs text-ink-700">
            MRP (paise)
            <input name="mrpPaise" type="number" min={1} required defaultValue={existing?.mrpPaise} className={`${field} identifier`} />
          </label>
          <label className="text-xs text-ink-700">
            Selling price (paise)
            <input name="sellingPricePaise" type="number" min={1} required defaultValue={existing?.sellingPricePaise} className={`${field} identifier`} />
          </label>
          <label className="text-xs text-ink-700">
            Stock
            <input name="stock" type="number" min={0} required defaultValue={existing?.stock ?? 0} className={`${field} identifier`} />
          </label>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Customer-facing copy</h2>
        <p className="mt-1 text-xs text-ink-500">
          For nutraceuticals, cosmetics and ayurvedic products this copy is
          checked for therapeutic claims and the save is refused if any are
          found. Medicines are exempt.
        </p>
        <div className="mt-3 grid gap-3">
          {([
            ["shortDescription", "Short description"],
            ["uses", "Uses"],
            ["howItWorks", "How it works"],
            ["directions", "Directions"],
            ["sideEffects", "Side effects"],
            ["warnings", "Warnings"],
            ["storage", "Storage"],
          ] as const).map(([name, label]) => (
            <label key={name} className="text-xs text-ink-700">
              {label}
              <textarea
                name={name}
                rows={2}
                defaultValue={(existing?.[name] as string | null) ?? ""}
                className={field}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap gap-4 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <label className="flex items-center gap-2 text-xs text-ink-700">
          <input name="isActive" type="checkbox" defaultChecked={existing?.isActive ?? true} className="accent-pine-700" />
          Listed in the catalogue
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-700">
          <input name="isRefrigerated" type="checkbox" defaultChecked={existing?.isRefrigerated ?? false} className="accent-pine-700" />
          Cold chain item
        </label>
      </section>

      {error && (
        <div role="alert" className="rx-gate rounded-r-[var(--radius-control)] p-3">
          <p className="whitespace-pre-line text-sm text-rx-700">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-5 py-2.5 text-sm font-semibold text-paper hover:bg-pine-900 disabled:bg-ink-100 disabled:text-ink-300"
        >
          {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {existing ? "Save changes" : "Create product"}
        </button>

        {existing && (
          <button
            type="button"
            onClick={onDelist}
            disabled={pending}
            className="rounded-[var(--radius-control)] border border-rx-500 px-4 py-2.5 text-sm font-medium text-rx-700 hover:bg-rx-50"
          >
            Delist
          </button>
        )}
      </div>
    </form>
  );
}
