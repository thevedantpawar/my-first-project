"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireUser } from "@/auth";
import {
  getStorage,
  newHealthRecordKey,
  signObjectUrl,
} from "@/lib/storage";
import { policy } from "@/lib/pharmacy";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { Relation, Gender } from "@/generated/prisma/enums";
import type { ActionResult } from "./cart";

/**
 * Customer account: profile, family members, health records.
 *
 * Every read and write is scoped to the signed-in user by the query itself
 * rather than by checking an id the caller supplied — `findFirst({ where: { id,
 * userId } })` rather than `findUnique({ where: { id } })` followed by a
 * comparison.
 */

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9][0-9]{9}$/, "Enter a valid 10-digit mobile number.")
    .optional()
    .or(z.literal("")),
});

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check your details.",
    };
  }

  const user = await requireUser();
  const { name, phone } = parsed.data;

  if (phone) {
    const taken = await db.user.findFirst({
      where: { phone, id: { not: user.id } },
      select: { id: true },
    });
    if (taken) {
      return { ok: false, error: "That mobile number is already in use." };
    }
  }

  await db.user.update({
    where: { id: user.id },
    // Changing the number clears verification — a phone that has not been
    // re-verified must not count as verified.
    data: { name, phone: phone || null, ...(phone ? { phoneVerified: null } : {}) },
  });

  revalidatePath("/account");
  return { ok: true, data: undefined };
}

/* ---------------------------------------------------------------------------
 * Family members
 *
 * Prescriptions are frequently written for a relative, and the Schedule H1
 * register needs a stable patient identity across refills rather than a name
 * retyped each time. Deleting a patient is refused once a prescription
 * references them.
 * ------------------------------------------------------------------------- */

const patientSchema = z.object({
  id: z.string().max(64).optional(),
  fullName: z.string().trim().min(2).max(120),
  relation: z.nativeEnum(Relation),
  gender: z.nativeEnum(Gender).default(Gender.UNDISCLOSED),
  ageYears: z.coerce.number().int().min(0).max(120).optional(),
  dateOfBirth: z.string().trim().max(10).optional().or(z.literal("")),
});

export async function savePatient(input: unknown): Promise<ActionResult> {
  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the details.",
    };
  }

  const user = await requireUser();
  const d = parsed.data;

  const values = {
    fullName: d.fullName,
    relation: d.relation,
    gender: d.gender,
    ageYears: d.ageYears ?? null,
    dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null,
  };

  if (d.id) {
    const existing = await db.patient.findFirst({
      where: { id: d.id, userId: user.id },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "That person is not on your account." };
    await db.patient.update({ where: { id: existing.id }, data: values });
  } else {
    await db.patient.create({ data: { ...values, userId: user.id } });
  }

  revalidatePath("/account/family");
  return { ok: true, data: undefined };
}

export async function deletePatient(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ patientId: z.string().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  const patient = await db.patient.findFirst({
    where: { id: parsed.data.patientId, userId: user.id },
    select: { id: true, _count: { select: { prescriptions: true } } },
  });
  if (!patient) return { ok: false, error: "That person is not on your account." };

  if (patient._count.prescriptions > 0) {
    return {
      ok: false,
      error:
        "This person is named on a prescription, which forms part of the dispensing record. They cannot be removed.",
    };
  }

  await db.patient.delete({ where: { id: patient.id } });
  revalidatePath("/account/family");
  return { ok: true, data: undefined };
}

/* ---------------------------------------------------------------------------
 * Health record vault
 *
 * Same private-storage discipline as prescriptions, with one difference: a
 * pharmacist can read a prescription because verification requires it, but a
 * lab report is nobody's business but the customer's. `/api/private-file`
 * enforces that distinction.
 * ------------------------------------------------------------------------- */

const MAX_RECORD_BYTES = 12 * 1024 * 1024;

const ACCEPTED_RECORD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function uploadHealthRecord(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();

  try {
    await enforceRateLimit("healthRecordUpload", user.id);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: error.message };
    throw error;
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a file to upload." };
  }
  if (file.size > MAX_RECORD_BYTES) {
    return { ok: false, error: "That file is larger than 12 MB." };
  }

  const extension = ACCEPTED_RECORD_TYPES[file.type];
  if (!extension) {
    return { ok: false, error: "Please upload a JPEG, PNG, WebP or PDF file." };
  }

  const parsed = z
    .object({
      title: z.string().trim().min(2).max(160),
      recordDate: z.string().trim().max(10).optional().or(z.literal("")),
      notes: z.string().trim().max(500).optional().or(z.literal("")),
    })
    .safeParse({
      title: formData.get("title") ?? "",
      recordDate: formData.get("recordDate") ?? "",
      notes: formData.get("notes") ?? "",
    });

  if (!parsed.success) {
    return { ok: false, error: "Please give the record a title." };
  }

  const key = newHealthRecordKey(extension);
  const bytes = Buffer.from(await file.arrayBuffer());

  // Store before recording, so no row ever points at bytes that were not written.
  try {
    await getStorage().put(key, bytes, file.type);
  } catch (error) {
    console.error("[health-records] private storage write failed", error);
    return {
      ok: false,
      error:
        "We could not store that file securely just now, so it has not been saved. Please try again shortly.",
    };
  }

  const record = await db.healthRecord.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      fileKey: key,
      mimeType: file.type,
      fileSizeBytes: bytes.byteLength,
      recordDate: parsed.data.recordDate ? new Date(parsed.data.recordDate) : null,
      notes: parsed.data.notes || null,
    },
    select: { id: true },
  });

  revalidatePath("/account/records");
  return { ok: true, data: { id: record.id } };
}

export async function getHealthRecordUrl(
  input: unknown,
): Promise<ActionResult<{ url: string }>> {
  const parsed = z.object({ recordId: z.string().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  const record = await db.healthRecord.findFirst({
    where: { id: parsed.data.recordId, userId: user.id },
    select: { fileKey: true },
  });
  if (!record) return { ok: false, error: "That record could not be found." };

  return {
    ok: true,
    data: { url: signObjectUrl(record.fileKey, policy.signedUrlTtlSeconds) },
  };
}

export async function deleteHealthRecord(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ recordId: z.string().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  const record = await db.healthRecord.findFirst({
    where: { id: parsed.data.recordId, userId: user.id },
    select: { id: true, fileKey: true },
  });
  if (!record) return { ok: false, error: "That record could not be found." };

  await db.healthRecord.delete({ where: { id: record.id } });
  await getStorage().delete(record.fileKey);

  revalidatePath("/account/records");
  return { ok: true, data: undefined };
}

/* ---------------------------------------------------------------------------
 * Reorder
 * ------------------------------------------------------------------------- */

/**
 * Copies a previous order's items back into the cart.
 *
 * Prescription linkage is deliberately NOT carried over: the earlier
 * prescription may have expired or run out of repeats, and silently reusing it
 * would make the Rx gate look satisfied when it is not. The customer re-attaches
 * a current prescription, and the gate re-checks it.
 */
export async function reorder(input: unknown): Promise<ActionResult<{ added: number; skipped: string[] }>> {
  const parsed = z.object({ orderId: z.string().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  const order = await db.order.findFirst({
    where: { id: parsed.data.orderId, userId: user.id },
    select: {
      items: {
        select: {
          quantity: true,
          product: {
            select: { id: true, name: true, isActive: true, stock: true, maxPerOrder: true },
          },
        },
      },
    },
  });
  if (!order) return { ok: false, error: "That order is not on your account." };

  const cart = await db.cart.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
    select: { id: true },
  });

  let added = 0;
  const skipped: string[] = [];

  for (const item of order.items) {
    const p = item.product;

    if (!p.isActive) {
      skipped.push(`${p.name} (no longer available)`);
      continue;
    }
    if (p.stock <= 0) {
      skipped.push(`${p.name} (out of stock)`);
      continue;
    }

    const quantity = Math.min(item.quantity, p.maxPerOrder, p.stock);

    await db.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: p.id } },
      update: { quantity },
      create: { cartId: cart.id, productId: p.id, quantity },
    });
    added++;
  }

  revalidatePath("/cart");
  return { ok: true, data: { added, skipped } };
}
