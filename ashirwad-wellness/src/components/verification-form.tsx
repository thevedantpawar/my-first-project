"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X, HelpCircle } from "lucide-react";

import { verifyPrescription, rejectPrescription } from "@/actions/pharmacist";

/**
 * The pharmacist's decision form.
 *
 * Prescriber name and registration number are re-entered here from the image
 * rather than accepted from what the customer typed. Those two values are
 * copied verbatim into the Schedule H1 register, where they are permanent.
 *
 * Rejection and clarification are separated because they mean different things
 * to the customer: a clarification is recoverable, a rejection is not.
 */
export function VerificationForm({
  prescriptionId,
  defaultValidityDays,
  initial,
}: {
  prescriptionId: string;
  defaultValidityDays: number;
  initial: {
    doctorName: string | null;
    doctorRegNo: string | null;
    hospitalName: string | null;
    issuedOn: Date | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"verify" | "reject" | "clarify">("verify");

  function submitVerify(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await verifyPrescription({
        prescriptionId,
        doctorName: formData.get("doctorName"),
        doctorRegNo: formData.get("doctorRegNo"),
        hospitalName: formData.get("hospitalName"),
        issuedOn: formData.get("issuedOn"),
        validityDays: formData.get("validityDays"),
        refillsAllowed: formData.get("refillsAllowed"),
        notes: formData.get("notes"),
      });
      if (result.ok) router.push("/pharmacist");
      else setError(result.error);
    });
  }

  function submitReject(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await rejectPrescription({
        prescriptionId,
        reason: formData.get("reason"),
        clarificationOnly: mode === "clarify",
      });
      if (result.ok) router.push("/pharmacist");
      else setError(result.error);
    });
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {[
          { key: "verify" as const, label: "Verify", icon: Check },
          { key: "clarify" as const, label: "Request clearer image", icon: HelpCircle },
          { key: "reject" as const, label: "Reject", icon: X },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={mode === tab.key}
            onClick={() => {
              setMode(tab.key);
              setError(null);
            }}
            className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-medium ${
              mode === tab.key
                ? tab.key === "verify"
                  ? "bg-living-600 text-paper"
                  : tab.key === "reject"
                    ? "bg-rx-500 text-paper"
                    : "bg-turmeric-500 text-ink-900"
                : "border border-ink-100 text-ink-700 hover:bg-pine-50"
            }`}
          >
            <tab.icon aria-hidden="true" className="size-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "verify" ? (
        <form action={submitVerify} className="mt-4 space-y-3">
          <p className="text-xs leading-relaxed text-ink-500">
            Read the prescriber&rsquo;s name and registration number from the
            image. These are copied into the Schedule H1 register, where they
            cannot be edited afterwards.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-700">
              Prescriber name <span className="text-rx-500">*</span>
              <input
                name="doctorName"
                required
                defaultValue={initial.doctorName ?? ""}
                className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-ink-700">
              Registration number <span className="text-rx-500">*</span>
              <input
                name="doctorRegNo"
                required
                defaultValue={initial.doctorRegNo ?? ""}
                placeholder="MMC/2011/44821"
                className="identifier mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-ink-700">
              Hospital or clinic
              <input
                name="hospitalName"
                defaultValue={initial.hospitalName ?? ""}
                className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-ink-700">
              Date on the prescription
              <input
                name="issuedOn"
                type="date"
                defaultValue={
                  initial.issuedOn
                    ? initial.issuedOn.toISOString().slice(0, 10)
                    : ""
                }
                className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid gap-3 rounded-[var(--radius-control)] bg-pine-50 p-3 sm:grid-cols-2">
            <label className="text-xs text-ink-700">
              Valid for (days)
              <input
                name="validityDays"
                type="number"
                min={1}
                max={365}
                defaultValue={defaultValidityDays}
                required
                className="identifier mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
              />
              <span className="mt-0.5 block text-[0.625rem] text-ink-500">
                30 days suits an acute course; extend for chronic repeat
                medication.
              </span>
            </label>
            <label className="text-xs text-ink-700">
              Repeats allowed
              <input
                name="refillsAllowed"
                type="number"
                min={0}
                max={11}
                defaultValue={0}
                required
                className="identifier mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
              />
              <span className="mt-0.5 block text-[0.625rem] text-ink-500">
                In addition to the first supply. 0 means one supply only.
              </span>
            </label>
          </div>

          <label className="block text-xs text-ink-700">
            Notes (internal)
            <textarea
              name="notes"
              rows={2}
              className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
            />
          </label>

          {error && (
            <p role="alert" className="text-xs text-rx-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-living-600 px-4 py-2.5 text-sm font-semibold text-paper hover:bg-living-700 disabled:bg-ink-100 disabled:text-ink-300"
          >
            {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Verify prescription
          </button>
        </form>
      ) : (
        <form action={submitReject} className="mt-4 space-y-3">
          <p className="text-xs leading-relaxed text-ink-500">
            {mode === "clarify"
              ? "The customer will be asked to upload a clearer image. Say exactly what is unreadable."
              : "The customer is told this reason verbatim. Be specific and clinical."}
          </p>

          <label className="block text-xs text-ink-700">
            Reason <span className="text-rx-500">*</span>
            <textarea
              name="reason"
              rows={3}
              required
              minLength={5}
              placeholder={
                mode === "clarify"
                  ? "The prescriber's registration number is cut off at the top of the image."
                  : "The prescription is dated more than six months ago and cannot be dispensed against."
              }
              className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
            />
          </label>

          {error && (
            <p role="alert" className="text-xs text-rx-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className={`flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-semibold disabled:bg-ink-100 disabled:text-ink-300 ${
              mode === "clarify"
                ? "bg-turmeric-500 text-ink-900 hover:bg-turmeric-600"
                : "bg-rx-500 text-paper hover:bg-rx-700"
            }`}
          >
            {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {mode === "clarify" ? "Request a clearer image" : "Reject prescription"}
          </button>
        </form>
      )}
    </div>
  );
}
