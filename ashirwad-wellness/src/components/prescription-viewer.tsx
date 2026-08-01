"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, RotateCw, ZoomIn, ZoomOut, ShieldAlert } from "lucide-react";

import { getPrescriptionViewUrl } from "@/actions/prescriptions";

/**
 * Prescription image viewer.
 *
 * The URL is minted per view, expires in minutes, and is never persisted.
 * Opening this writes a PRESCRIPTION_VIEWED audit row naming the viewer — a
 * pharmacist should know their access is recorded, and so should the customer.
 *
 * Zoom and rotate are not decoration: prescriptions arrive as phone photos of
 * handwriting, often sideways, and a pharmacist who cannot read the prescriber's
 * registration number cannot verify it.
 */
export function PrescriptionViewer({
  prescriptionId,
  mimeType,
}: {
  prescriptionId: string;
  mimeType: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    setExpired(false);
    setUnreadable(false);
    const result = await getPrescriptionViewUrl({ prescriptionId });
    if (result.ok) {
      setUrl(result.data.url);
      // Drop the URL from state a little before it expires, so the viewer
      // shows a refresh prompt rather than a broken image.
      const ms = Math.max(5, result.data.expiresInSeconds - 15) * 1000;
      setTimeout(() => setExpired(true), ms);
    } else {
      setError(result.error);
    }
  }, [prescriptionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isPdf = mimeType === "application/pdf";

  return (
    <div className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs text-ink-500">
          <ShieldAlert aria-hidden="true" className="size-3.5 text-rx-500" />
          Access to this image is logged
        </p>

        {!isPdf && url && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
              className="grid size-7 place-items-center rounded-[var(--radius-control)] border border-ink-100 hover:bg-pine-50"
            >
              <ZoomOut aria-hidden="true" className="size-3.5" />
            </button>
            <span className="identifier w-10 text-center text-xs text-ink-500">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              className="grid size-7 place-items-center rounded-[var(--radius-control)] border border-ink-100 hover:bg-pine-50"
            >
              <ZoomIn aria-hidden="true" className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Rotate 90 degrees"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="grid size-7 place-items-center rounded-[var(--radius-control)] border border-ink-100 hover:bg-pine-50"
            >
              <RotateCw aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="max-h-[70vh] overflow-auto bg-paper-sunk p-3">
        {error ? (
          <p role="alert" className="p-6 text-center text-sm text-rx-700">
            {error}
          </p>
        ) : expired ? (
          <div className="p-6 text-center">
            <p className="text-sm text-ink-700">
              This viewing link has expired.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 rounded-[var(--radius-control)] bg-pine-700 px-3 py-1.5 text-xs font-semibold text-paper"
            >
              Load again
            </button>
          </div>
        ) : unreadable ? (
          // A signed URL that resolves to nothing. The object is missing from
          // storage, or was never written. This must never render as an empty
          // frame: a pharmacist looking at blank space has to be told they are
          // looking at blank space, because the whole decision is "read this
          // image and judge it". Silence here invites verifying unseen.
          <div className="rx-gate rounded-r-[var(--radius-control)] p-6 text-center">
            <p className="text-sm font-semibold text-rx-700">
              This prescription image could not be loaded.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-rx-700">
              The file is missing from storage. Do not verify this prescription —
              there is nothing to verify against. Ask the customer to upload it
              again, and report this if it recurs.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-[var(--radius-control)] bg-pine-700 px-3 py-1.5 text-xs font-semibold text-paper"
            >
              Try again
            </button>
          </div>
        ) : !url ? (
          <div className="grid place-items-center p-12">
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-300" />
          </div>
        ) : isPdf ? (
          <iframe
            src={url}
            title="Prescription document"
            className="h-[65vh] w-full rounded-[var(--radius-control)] border border-ink-100 bg-white"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Prescription"
            onError={() => setUnreadable(true)}
            // Same reason as ProductImage: a server-rendered image can finish
            // failing before React attaches onError, so an already-failed load
            // is detected at attach time too.
            ref={(node) => {
              if (node && node.complete && node.naturalWidth === 0) setUnreadable(true);
            }}
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: "center center",
            }}
            className="mx-auto max-w-full rounded-[var(--radius-control)] bg-white transition-transform"
          />
        )}
      </div>
    </div>
  );
}
