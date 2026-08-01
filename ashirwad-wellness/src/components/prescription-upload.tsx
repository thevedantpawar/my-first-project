"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Upload, X, FileCheck2 } from "lucide-react";

import { uploadPrescription } from "@/actions/prescriptions";

/**
 * Prescription upload — drag and drop, file picker, or phone camera.
 *
 * Images are downscaled and re-encoded in the browser before upload. A modern
 * phone camera produces 4–8 MB files, most of a prescription photo is empty
 * paper, and a customer on a patchy connection abandoning the upload is a
 * customer who does not get their medicine. 2000px on the long edge is well
 * past what a pharmacist needs to read a prescription.
 *
 * PDFs are passed through untouched — re-encoding a PDF through a canvas would
 * destroy it.
 */

const MAX_EDGE_PX = 2000;
const JPEG_QUALITY = 0.82;

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") {
    // HEIC has no canvas decoder in most browsers; send it as-is and let the
    // pharmacist's viewer deal with it.
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));

    // Already small enough and reasonably sized — don't re-encode for nothing.
    if (scale === 1 && file.size < 1_500_000) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext("2d");
    if (!context) return file;

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    // Compression is an optimisation. If anything goes wrong, upload the
    // original rather than failing the customer's upload.
    return file;
  }
}

export function PrescriptionUpload({
  onUploaded,
  compact = false,
}: {
  onUploaded?: (prescriptionId: string) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [compressing, setCompressing] = useState(false);

  async function accept(candidate: File | undefined) {
    if (!candidate) return;
    setError(null);
    setCompressing(true);

    try {
      const processed = await compressImage(candidate);
      setFile(processed);
      setPreview(
        processed.type.startsWith("image/") ? URL.createObjectURL(processed) : null,
      );
    } finally {
      setCompressing(false);
    }
  }

  function clear() {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  function submit(formData: FormData) {
    if (!file) {
      setError("Please choose a prescription image first.");
      return;
    }
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadPrescription(formData);
      if (result.ok) {
        clear();
        onUploaded?.(result.data.prescriptionId);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form action={submit} className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void accept(e.dataTransfer.files[0]);
        }}
        className={`rounded-[var(--radius-card)] border-2 border-dashed p-5 text-center transition-colors ${
          dragging
            ? "border-living-500 bg-living-50"
            : "border-ink-100 bg-paper-raised"
        }`}
      >
        {preview ? (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Prescription preview"
              className="mx-auto max-h-48 rounded-[var(--radius-control)] border border-ink-100 object-contain"
            />
            <p className="identifier text-xs text-ink-500">
              {file?.name} · {((file?.size ?? 0) / 1024).toFixed(0)} KB
            </p>
            <button
              type="button"
              onClick={clear}
              className="inline-flex items-center gap-1 text-xs text-rx-700 hover:underline"
            >
              <X aria-hidden="true" className="size-3" />
              Choose a different file
            </button>
          </div>
        ) : file ? (
          <div className="space-y-2">
            <FileCheck2 aria-hidden="true" className="mx-auto size-8 text-living-600" />
            <p className="identifier text-xs text-ink-700">{file.name}</p>
            <button
              type="button"
              onClick={clear}
              className="text-xs text-rx-700 hover:underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Upload aria-hidden="true" className="mx-auto size-8 text-ink-300" />
            <div>
              <p className="text-sm text-ink-700">
                Drag your prescription here, or
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="rounded-[var(--radius-control)] border border-ink-100 px-3 py-1.5 text-sm text-ink-700 hover:bg-pine-50"
                >
                  Choose a file
                </button>
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-ink-100 px-3 py-1.5 text-sm text-ink-700 hover:bg-pine-50 sm:hidden"
                >
                  <Camera aria-hidden="true" className="size-3.5" />
                  Take a photo
                </button>
              </div>
            </div>
            <p className="text-[0.6875rem] text-ink-300">
              JPEG, PNG, WebP, HEIC or PDF · up to 8 MB
            </p>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          className="sr-only"
          onChange={(e) => void accept(e.target.files?.[0])}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => void accept(e.target.files?.[0])}
        />
      </div>

      {!compact && file && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-ink-700">
            Doctor&rsquo;s name
            <input
              name="doctorName"
              type="text"
              placeholder="Dr A. Sharma"
              className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-2.5 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-ink-700">
            Registration number
            <input
              name="doctorRegNo"
              type="text"
              placeholder="MMC/12345"
              className="identifier mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-2.5 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-ink-700">
            Hospital or clinic
            <input
              name="hospitalName"
              type="text"
              className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-2.5 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-ink-700">
            Date on the prescription
            <input
              name="issuedOn"
              type="date"
              className="mt-1 w-full rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-2.5 py-2 text-sm"
            />
          </label>
          <p className="text-[0.6875rem] leading-relaxed text-ink-300 sm:col-span-2">
            These help the pharmacist verify faster. They will be confirmed
            against the image before anything is dispensed, so an
            approximation is fine.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-rx-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!file || pending || compressing}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-pine-700 px-4 py-2.5 text-sm font-semibold text-paper hover:bg-pine-900 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-300"
      >
        {(pending || compressing) && (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        )}
        {compressing
          ? "Preparing image…"
          : pending
            ? "Uploading…"
            : "Upload prescription"}
      </button>

      <p className="text-[0.6875rem] leading-relaxed text-ink-500">
        Your prescription is stored privately and is visible only to you and the
        registered pharmacist reviewing it. Every access is logged.
      </p>
    </form>
  );
}
