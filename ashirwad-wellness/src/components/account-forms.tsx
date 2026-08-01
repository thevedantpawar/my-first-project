"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Plus, Download, RotateCcw, Eye } from "lucide-react";

import {
  updateProfile,
  savePatient,
  deletePatient,
  uploadHealthRecord,
  deleteHealthRecord,
  getHealthRecordUrl,
  reorder,
} from "@/actions/account";
import { setDefaultAddress, deleteAddress } from "@/actions/addresses";
import { Relation, Gender } from "@/generated/prisma/enums";

const field =
  "mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-2.5 py-2 text-sm";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMessage?: string,
  ) => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        if (successMessage) setDone(successMessage);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  };

  return { run, pending, error, done };
}

function Feedback({ error, done }: { error: string | null; done: string | null }) {
  if (error)
    return (
      <p role="alert" className="mt-2 text-xs text-rx-700">
        {error}
      </p>
    );
  if (done)
    return (
      <p role="status" className="mt-2 text-xs text-living-600">
        {done}
      </p>
    );
  return null;
}

export function ProfileForm({
  initial,
}: {
  initial: { name: string | null; email: string | null; phone: string | null };
}) {
  const { run, pending, error, done } = useAction();

  return (
    <form
      action={(fd) =>
        run(
          () => updateProfile({ name: fd.get("name"), phone: fd.get("phone") }),
          "Profile saved.",
        )
      }
      className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4"
    >
      <h2 className="text-sm font-semibold text-ink">Your details</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-700">
          Full name
          <input name="name" required defaultValue={initial.name ?? ""} className={field} />
        </label>
        <label className="text-xs text-ink-700">
          Mobile number
          <input
            name="phone"
            inputMode="numeric"
            maxLength={10}
            defaultValue={initial.phone ?? ""}
            className={`${field} identifier`}
          />
        </label>
        <label className="text-xs text-ink-300 sm:col-span-2">
          Email (used to sign in)
          <input
            value={initial.email ?? ""}
            disabled
            className={`${field} cursor-not-allowed opacity-70`}
          />
        </label>
      </div>

      <Feedback error={error} done={done} />

      <button
        type="submit"
        disabled={pending}
        className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-4 py-2 text-sm font-semibold text-paper disabled:bg-ink-100 disabled:text-ink-300"
      >
        {pending && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
        Save
      </button>
    </form>
  );
}

export function PatientManager({
  patients,
}: {
  patients: {
    id: string;
    fullName: string;
    relation: Relation;
    gender: Gender;
    ageYears: number | null;
    prescriptionCount: number;
  }[];
}) {
  const { run, pending, error, done } = useAction();
  const [adding, setAdding] = useState(patients.length === 0);

  return (
    <div className="space-y-3">
      {patients.length > 0 && (
        <ul className="space-y-2">
          {patients.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink">{p.fullName}</p>
                <p className="text-xs text-ink-500">
                  {p.relation.toLowerCase()}
                  {p.ageYears !== null && ` · ${p.ageYears} years`}
                  {p.gender !== Gender.UNDISCLOSED && ` · ${p.gender.toLowerCase()}`}
                </p>
                {p.prescriptionCount > 0 && (
                  <p className="identifier text-[0.625rem] text-ink-300">
                    named on {p.prescriptionCount} prescription
                    {p.prescriptionCount === 1 ? "" : "s"}
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deletePatient({ patientId: p.id }))}
                className="flex shrink-0 items-center gap-1 text-xs text-ink-500 hover:text-rx-700"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <Feedback error={error} done={done} />

      {adding ? (
        <form
          action={(fd) =>
            run(
              () =>
                savePatient({
                  fullName: fd.get("fullName"),
                  relation: fd.get("relation"),
                  gender: fd.get("gender"),
                  ageYears: fd.get("ageYears") || undefined,
                }),
              "Family member added.",
            )
          }
          className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4"
        >
          <h3 className="text-sm font-semibold text-ink">Add a family member</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-700">
              Full name
              <input name="fullName" required className={field} />
            </label>
            <label className="text-xs text-ink-700">
              Relation
              <select name="relation" className={field} defaultValue={Relation.CHILD}>
                {Object.values(Relation).map((r) => (
                  <option key={r} value={r}>
                    {r.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-700">
              Age
              <input name="ageYears" type="number" min={0} max={120} className={`${field} identifier`} />
            </label>
            <label className="text-xs text-ink-700">
              Gender
              <select name="gender" className={field} defaultValue={Gender.UNDISCLOSED}>
                {Object.values(Gender).map((g) => (
                  <option key={g} value={g}>
                    {g.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="flex items-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-4 py-2 text-sm font-semibold text-paper disabled:bg-ink-100"
            >
              {pending && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
              Add
            </button>
            {patients.length > 0 && (
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-[var(--radius-control)] border border-ink-100 px-4 py-2 text-sm text-ink-700"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-sm text-living-600 hover:underline"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add a family member
        </button>
      )}
    </div>
  );
}

export function AddressActions({
  addressId,
  isDefault,
}: {
  addressId: string;
  isDefault: boolean;
}) {
  const { run, pending, error } = useAction();

  return (
    <div className="flex items-center gap-3">
      {!isDefault && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setDefaultAddress({ addressId }))}
          className="text-xs text-living-600 hover:underline"
        >
          Make default
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => deleteAddress({ addressId }))}
        className="flex items-center gap-1 text-xs text-ink-500 hover:text-rx-700"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        Remove
      </button>
      <Feedback error={error} done={null} />
    </div>
  );
}

export function ReorderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await reorder({ orderId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { added, skipped } = result.data;
      setMessage(
        `${added} item${added === 1 ? "" : "s"} added to your cart.` +
          (skipped.length ? ` Skipped: ${skipped.join(", ")}.` : ""),
      );
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-pine-700 px-3 py-1.5 text-xs font-medium text-pine-700 hover:bg-pine-50 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <RotateCcw aria-hidden="true" className="size-3.5" />
        )}
        Order again
      </button>

      {message && (
        <p role="status" className="mt-1 text-[0.6875rem] text-living-600">
          {message} Prescription medicines need a current prescription attached
          again.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-[0.6875rem] text-rx-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function HealthRecordManager({
  records,
}: {
  records: {
    id: string;
    title: string;
    mimeType: string | null;
    recordDate: Date | null;
    notes: string | null;
    createdAt: Date;
  }[];
}) {
  const { run, pending, error, done } = useAction();
  const [opening, setOpening] = useState<string | null>(null);

  async function view(recordId: string) {
    setOpening(recordId);
    const result = await getHealthRecordUrl({ recordId });
    setOpening(null);
    if (result.ok) window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-4">
      <form
        action={(fd) => run(() => uploadHealthRecord(fd), "Record saved.")}
        className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4"
      >
        <h3 className="text-sm font-semibold text-ink">Add a record</h3>
        <p className="mt-1 text-xs text-ink-500">
          Lab reports, discharge summaries, scans. Stored privately and visible
          only to you — not to our pharmacists.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-ink-700">
            Title
            <input name="title" required placeholder="Blood test — March 2026" className={field} />
          </label>
          <label className="text-xs text-ink-700">
            Date on the record
            <input name="recordDate" type="date" className={field} />
          </label>
          <label className="text-xs text-ink-700 sm:col-span-2">
            Notes
            <input name="notes" className={field} />
          </label>
          <label className="text-xs text-ink-700 sm:col-span-2">
            File
            <input
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              required
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-pine-700 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper"
            />
          </label>
        </div>

        <Feedback error={error} done={done} />

        <button
          type="submit"
          disabled={pending}
          className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-4 py-2 text-sm font-semibold text-paper disabled:bg-ink-100"
        >
          {pending && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
          Upload
        </button>
      </form>

      {records.length > 0 && (
        <ul className="space-y-2">
          {records.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink">{r.title}</p>
                <p className="identifier text-[0.625rem] text-ink-300">
                  {(r.recordDate ?? r.createdAt).toLocaleDateString("en-IN")}
                  {r.mimeType && ` · ${r.mimeType.split("/")[1].toUpperCase()}`}
                </p>
                {r.notes && <p className="text-xs text-ink-500">{r.notes}</p>}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => void view(r.id)}
                  disabled={opening === r.id}
                  className="flex items-center gap-1 text-xs text-living-600 hover:underline"
                >
                  {opening === r.id ? (
                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <Eye aria-hidden="true" className="size-3.5" />
                  )}
                  View
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deleteHealthRecord({ recordId: r.id }))}
                  className="flex items-center gap-1 text-xs text-ink-500 hover:text-rx-700"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function InvoiceLink({ orderNumber }: { orderNumber: string }) {
  return (
    <a
      href={`/account/orders/${orderNumber}/invoice`}
      className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-pine-50"
    >
      <Download aria-hidden="true" className="size-3.5" />
      Invoice (PDF)
    </a>
  );
}
