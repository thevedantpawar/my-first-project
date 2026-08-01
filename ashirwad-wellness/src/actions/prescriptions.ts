"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireUser } from "@/auth";
import { audit } from "@/lib/audit";
import {
  getStorage,
  newPrescriptionKey,
  signObjectUrl,
} from "@/lib/storage";
import { policy } from "@/lib/pharmacy";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { PrescriptionStatus } from "@/generated/prisma/enums";
import type { ActionResult } from "./cart";

/**
 * Prescription upload and access.
 *
 * A prescription image is sensitive personal data. Three rules hold here:
 *
 *  - The bytes go straight to private storage; only the opaque key is stored.
 *  - A viewing URL is minted per request, expires in minutes, and is never
 *    persisted.
 *  - Every view writes an audit row naming who looked at it.
 */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ACCEPTED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

const uploadMetaSchema = z.object({
  doctorName: z.string().trim().max(120).optional().or(z.literal("")),
  doctorRegNo: z.string().trim().max(60).optional().or(z.literal("")),
  hospitalName: z.string().trim().max(160).optional().or(z.literal("")),
  issuedOn: z.string().trim().max(10).optional().or(z.literal("")),
  patientId: z.string().trim().max(64).optional().or(z.literal("")),
});

export async function uploadPrescription(
  formData: FormData,
): Promise<ActionResult<{ prescriptionId: string }>> {
  const user = await requireUser();

  try {
    await enforceRateLimit("prescriptionUpload", user.id);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: error.message };
    throw error;
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a prescription image to upload." };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "That file is larger than 8 MB. Please retake or compress it.",
    };
  }

  const extension = ACCEPTED_TYPES[file.type];
  if (!extension) {
    return {
      ok: false,
      error: "Please upload a JPEG, PNG, WebP, HEIC or PDF file.",
    };
  }

  const parsedMeta = uploadMetaSchema.safeParse({
    doctorName: formData.get("doctorName") ?? "",
    doctorRegNo: formData.get("doctorRegNo") ?? "",
    hospitalName: formData.get("hospitalName") ?? "",
    issuedOn: formData.get("issuedOn") ?? "",
    patientId: formData.get("patientId") ?? "",
  });
  if (!parsedMeta.success) {
    return { ok: false, error: "Some prescription details are not valid." };
  }
  const meta = parsedMeta.data;

  // A patient must belong to this customer. Never trust the posted id.
  let patientId: string | null = null;
  if (meta.patientId) {
    const patient = await db.patient.findFirst({
      where: { id: meta.patientId, userId: user.id },
      select: { id: true },
    });
    if (!patient) {
      return { ok: false, error: "That family member is not on your account." };
    }
    patientId = patient.id;
  }

  const key = newPrescriptionKey(extension);
  const bytes = Buffer.from(await file.arrayBuffer());

  // A storage misconfiguration is an operator problem, not a customer one.
  // It must fail loudly in the logs and politely on screen — and it must fail
  // *before* a Prescription row exists, so there is never a database record
  // pointing at bytes that were never written.
  try {
    await getStorage().put(key, bytes, file.type);
  } catch (error) {
    console.error("[prescriptions] private storage write failed", error);
    return {
      ok: false,
      error:
        "We could not store your prescription securely just now, so it has not been saved. Please try again shortly, or contact us if this keeps happening.",
    };
  }

  const prescription = await db.prescription.create({
    data: {
      userId: user.id,
      patientId,
      imageKey: key,
      mimeType: file.type,
      fileSizeBytes: bytes.byteLength,
      status: PrescriptionStatus.UPLOADED,
      doctorName: meta.doctorName || null,
      doctorRegNo: meta.doctorRegNo || null,
      hospitalName: meta.hospitalName || null,
      issuedOn: meta.issuedOn ? new Date(meta.issuedOn) : null,
    },
    select: { id: true },
  });

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "PRESCRIPTION_UPLOADED",
    entityType: "Prescription",
    entityId: prescription.id,
    // The key is recorded, never the image and never a URL.
    metadata: { imageKey: key, sizeBytes: bytes.byteLength, mimeType: file.type },
  });

  revalidatePath("/cart");
  revalidatePath("/checkout");
  revalidatePath("/account/prescriptions");

  return { ok: true, data: { prescriptionId: prescription.id } };
}

const viewSchema = z.object({ prescriptionId: z.string().min(1).max(64) });

/**
 * Mints a short-lived viewing URL.
 *
 * Customers may view their own; pharmacists and admins may view any, because
 * verification requires it. Every call is audited either way.
 */
export async function getPrescriptionViewUrl(
  input: unknown,
): Promise<ActionResult<{ url: string; expiresInSeconds: number }>> {
  const parsed = viewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();
  const privileged = user.role === "PHARMACIST" || user.role === "ADMIN";

  const prescription = await db.prescription.findFirst({
    where: {
      id: parsed.data.prescriptionId,
      ...(privileged ? {} : { userId: user.id }),
    },
    select: { id: true, imageKey: true, userId: true },
  });

  if (!prescription) {
    return { ok: false, error: "That prescription could not be found." };
  }

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "PRESCRIPTION_VIEWED",
    entityType: "Prescription",
    entityId: prescription.id,
    metadata: {
      ownerId: prescription.userId,
      viewedByPrivilegedRole: privileged,
    },
  });

  return {
    ok: true,
    data: {
      url: signObjectUrl(prescription.imageKey, policy.signedUrlTtlSeconds),
      expiresInSeconds: policy.signedUrlTtlSeconds,
    },
  };
}

const deleteSchema = z.object({ prescriptionId: z.string().min(1).max(64) });

/**
 * Removes a prescription the customer uploaded.
 *
 * Refused once it has been used to dispense — the record is part of the
 * dispensing trail at that point, and the H1 register references it.
 */
export async function deletePrescription(input: unknown): Promise<ActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  const prescription = await db.prescription.findFirst({
    where: { id: parsed.data.prescriptionId, userId: user.id },
    select: { id: true, imageKey: true, _count: { select: { orderItems: true } } },
  });

  if (!prescription) {
    return { ok: false, error: "That prescription could not be found." };
  }

  if (prescription._count.orderItems > 0) {
    return {
      ok: false,
      error:
        "This prescription has been dispensed against and forms part of the dispensing record. It cannot be deleted.",
    };
  }

  await db.cartItem.updateMany({
    where: { prescriptionId: prescription.id },
    data: { prescriptionId: null },
  });

  await db.prescription.delete({ where: { id: prescription.id } });
  await getStorage().delete(prescription.imageKey);

  revalidatePath("/account/prescriptions");
  revalidatePath("/cart");
  return { ok: true, data: undefined };
}
