"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X, BookLock } from "lucide-react";

import { approveOrder, rejectOrder } from "@/actions/pharmacist";

type H1Line = {
  orderItemId: string;
  name: string;
  quantity: number;
  composition: string;
  /** Batch numbers already in inventory for this product, if any. */
  knownBatches: { batchNumber: string; expiryDate: string }[];
};

/**
 * Order approval.
 *
 * Approving writes a Schedule H1 register entry for every H1 line, permanently.
 * Batch number and expiry are captured here because the register has columns
 * for them and because they are read off the physical pack being dispensed —
 * not inferred.
 */
export function OrderReviewForm({
  orderId,
  h1Lines,
}: {
  orderId: string;
  h1Lines: H1Line[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"approve" | "reject">("approve");

  const [batches, setBatches] = useState<
    Record<string, { batchNumber: string; expiryDate: string }>
  >(() =>
    Object.fromEntries(
      h1Lines.map((l) => [
        l.orderItemId,
        {
          batchNumber: l.knownBatches[0]?.batchNumber ?? "",
          expiryDate: l.knownBatches[0]?.expiryDate ?? "",
        },
      ]),
    ),
  );

  function submitApprove(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await approveOrder({
        orderId,
        h1Batches: h1Lines.map((l) => ({
          orderItemId: l.orderItemId,
          batchNumber: batches[l.orderItemId]?.batchNumber ?? "",
          expiryDate: batches[l.orderItemId]?.expiryDate ?? "",
        })),
        notes: formData.get("notes"),
      });
      if (result.ok) router.push("/pharmacist/orders");
      else setError(result.error);
    });
  }

  function submitReject(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await rejectOrder({
        orderId,
        reason: formData.get("reason"),
      });
      if (result.ok) router.push("/pharmacist/orders");
      else setError(result.error);
    });
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setMode("approve")}
          className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-medium ${
            mode === "approve"
              ? "bg-living-500 text-paper"
              : "border border-ink-100 text-ink-700"
          }`}
        >
          <Check aria-hidden="true" className="size-3.5" />
          Approve for dispensing
        </button>
        <button
          type="button"
          onClick={() => setMode("reject")}
          className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-medium ${
            mode === "reject"
              ? "bg-rx-500 text-paper"
              : "border border-ink-100 text-ink-700"
          }`}
        >
          <X aria-hidden="true" className="size-3.5" />
          Decline
        </button>
      </div>

      {mode === "approve" ? (
        <form action={submitApprove} className="mt-4 space-y-3">
          {h1Lines.length > 0 && (
            <div className="rx-gate rounded-r-[var(--radius-control)] p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-rx-700">
                <BookLock aria-hidden="true" className="size-3.5" />
                Schedule H1 register entries will be written
              </p>
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-rx-700">
                One permanent entry per item below, stamped with your name and
                registration number. Entries cannot be edited afterwards — only
                corrected by a further entry.
              </p>

              <div className="mt-3 space-y-3">
                {h1Lines.map((line) => (
                  <div
                    key={line.orderItemId}
                    className="rounded-[var(--radius-control)] bg-paper-raised p-3"
                  >
                    <p className="text-xs font-medium text-ink">
                      <span className="identifier text-ink-300">
                        {line.quantity}×
                      </span>{" "}
                      {line.name}
                    </p>
                    <p className="text-[0.6875rem] text-ink-500">
                      {line.composition}
                    </p>

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="text-[0.6875rem] text-ink-700">
                        Batch number <span className="text-rx-500">*</span>
                        <input
                          required
                          list={`batches-${line.orderItemId}`}
                          value={batches[line.orderItemId]?.batchNumber ?? ""}
                          onChange={(e) =>
                            setBatches((b) => ({
                              ...b,
                              [line.orderItemId]: {
                                ...b[line.orderItemId],
                                batchNumber: e.target.value,
                              },
                            }))
                          }
                          className="identifier mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2 py-1.5 text-xs"
                        />
                        <datalist id={`batches-${line.orderItemId}`}>
                          {line.knownBatches.map((b) => (
                            <option key={b.batchNumber} value={b.batchNumber} />
                          ))}
                        </datalist>
                      </label>

                      <label className="text-[0.6875rem] text-ink-700">
                        Expiry <span className="text-rx-500">*</span>
                        <input
                          required
                          type="date"
                          value={batches[line.orderItemId]?.expiryDate ?? ""}
                          onChange={(e) =>
                            setBatches((b) => ({
                              ...b,
                              [line.orderItemId]: {
                                ...b[line.orderItemId],
                                expiryDate: e.target.value,
                              },
                            }))
                          }
                          className="identifier mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2 py-1.5 text-xs"
                        />
                      </label>
                    </div>

                    <p className="mt-1 text-[0.625rem] text-ink-300">
                      Read from the pack being dispensed.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="block text-xs text-ink-700">
            Notes (recorded on the order timeline)
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
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-living-500 px-4 py-2.5 text-sm font-semibold text-paper hover:bg-living-600 disabled:bg-ink-100 disabled:text-ink-300"
          >
            {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {h1Lines.length > 0
              ? `Approve and record ${h1Lines.length} register ${h1Lines.length === 1 ? "entry" : "entries"}`
              : "Approve for dispensing"}
          </button>
        </form>
      ) : (
        <form action={submitReject} className="mt-4 space-y-3">
          <label className="block text-xs text-ink-700">
            Reason <span className="text-rx-500">*</span>
            <textarea
              name="reason"
              rows={3}
              required
              minLength={5}
              placeholder="The prescription authorises 10 tablets; this order requests 30."
              className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 px-2.5 py-2 text-sm"
            />
          </label>
          <p className="text-[0.6875rem] text-ink-500">
            The customer is told this reason. Stock is returned automatically.
          </p>

          {error && (
            <p role="alert" className="text-xs text-rx-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-rx-500 px-4 py-2.5 text-sm font-semibold text-paper hover:bg-rx-700 disabled:bg-ink-100 disabled:text-ink-300"
          >
            {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Decline order
          </button>
        </form>
      )}
    </div>
  );
}
