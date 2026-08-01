"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireUser } from "@/auth";
import { AddressType } from "@/generated/prisma/enums";
import type { ActionResult } from "./cart";

/**
 * Address book and pincode serviceability.
 *
 * Dispensing is tied to licensed premises, so delivery is allow-list only:
 * a pincode absent from ServiceablePincode is not serviceable. There is no
 * default-open path, and the check runs again at checkout.
 */

const pincodeSchema = z.string().regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit pincode.");

export type ServiceabilityResult =
  | {
      serviceable: true;
      pincode: string;
      city: string;
      state: string;
      etaHours: number;
      codAvailable: boolean;
    }
  | { serviceable: false; pincode: string; reason: string };

export async function checkPincode(input: unknown): Promise<ServiceabilityResult> {
  const parsed = pincodeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      serviceable: false,
      pincode: String(input ?? ""),
      reason: "Enter a valid 6-digit pincode.",
    };
  }

  const match = await db.serviceablePincode.findFirst({
    where: { pincode: parsed.data, isActive: true },
  });

  if (!match) {
    return {
      serviceable: false,
      pincode: parsed.data,
      reason:
        "We do not deliver to this pincode yet. Ashirwad Medical dispenses from licensed premises in Nashik and delivers within the district.",
    };
  }

  return {
    serviceable: true,
    pincode: match.pincode,
    city: match.city,
    state: match.state,
    etaHours: match.etaHours,
    codAvailable: match.codAvailable,
  };
}

const addressSchema = z.object({
  id: z.string().max(64).optional(),
  label: z.nativeEnum(AddressType).default(AddressType.HOME),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[6-9][0-9]{9}$/, "Enter a valid 10-digit mobile number."),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  landmark: z.string().trim().max(120).optional().or(z.literal("")),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: pincodeSchema,
  isDefault: z.boolean().default(false),
});

export async function saveAddress(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the address details.",
    };
  }

  const user = await requireUser();
  const data = parsed.data;

  // Serviceability is re-checked here, not just in the UI widget.
  const serviceable = await checkPincode(data.pincode);
  if (!serviceable.serviceable) {
    return { ok: false, error: serviceable.reason };
  }

  const values = {
    label: data.label,
    fullName: data.fullName,
    phone: data.phone,
    line1: data.line1,
    line2: data.line2 || null,
    landmark: data.landmark || null,
    city: data.city,
    state: data.state,
    pincode: data.pincode,
  };

  const saved = await db.$transaction(async (tx) => {
    let addressId: string;

    if (data.id) {
      const existing = await tx.address.findFirst({
        where: { id: data.id, userId: user.id },
        select: { id: true },
      });
      if (!existing) throw new Error("That address is not on your account.");

      await tx.address.update({ where: { id: existing.id }, data: values });
      addressId = existing.id;
    } else {
      const created = await tx.address.create({
        data: { ...values, userId: user.id },
        select: { id: true },
      });
      addressId = created.id;
    }

    // Exactly one default. Setting a new one clears the rest in the same
    // transaction, so there is never a moment with two.
    const isFirstAddress =
      (await tx.address.count({ where: { userId: user.id } })) === 1;

    if (data.isDefault || isFirstAddress) {
      await tx.address.updateMany({
        where: { userId: user.id },
        data: { isDefault: false },
      });
      await tx.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
    }

    return addressId;
  });

  revalidatePath("/checkout");
  revalidatePath("/account/addresses");
  return { ok: true, data: { id: saved } };
}

const idSchema = z.object({ addressId: z.string().min(1).max(64) });

export async function setDefaultAddress(input: unknown): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  const address = await db.address.findFirst({
    where: { id: parsed.data.addressId, userId: user.id },
    select: { id: true },
  });
  if (!address) return { ok: false, error: "That address is not on your account." };

  await db.$transaction([
    db.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } }),
    db.address.update({ where: { id: address.id }, data: { isDefault: true } }),
  ]);

  revalidatePath("/checkout");
  revalidatePath("/account/addresses");
  return { ok: true, data: undefined };
}

export async function deleteAddress(input: unknown): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const user = await requireUser();

  // Orders snapshot the address at placement, so removing it here cannot
  // rewrite where a dispensed order was sent.
  const deleted = await db.address.deleteMany({
    where: { id: parsed.data.addressId, userId: user.id },
  });

  if (deleted.count === 0) {
    return { ok: false, error: "That address is not on your account." };
  }

  revalidatePath("/checkout");
  revalidatePath("/account/addresses");
  return { ok: true, data: undefined };
}

export async function listAddresses() {
  const user = await requireUser();
  return db.address.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}
