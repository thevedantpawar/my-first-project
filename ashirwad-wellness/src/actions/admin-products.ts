"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireAdmin } from "@/auth";
import { audit } from "@/lib/audit";
import { requiresPrescription } from "@/lib/schedule";
import { assertNoTherapeuticClaims, TherapeuticClaimError } from "@/lib/claims";
import {
  assertNotBannedSubstance,
  assertPermittedScheduleType,
  BannedSubstanceError,
} from "@/lib/banned-substances";
import { ScheduleType, DosageForm } from "@/generated/prisma/enums";
import type { ActionResult } from "./cart";

/**
 * Product creation and editing.
 *
 * Four gates run on every write, in this order, before anything touches the
 * database:
 *
 *   1. Schedule type must be one this platform may list at all.
 *   2. Name and composition must not match a banned substance.
 *   3. Copy must be free of therapeutic claims for claim-restricted classes.
 *   4. requiresPrescription is *derived*, never accepted from the form.
 *
 * Behind all four, the database has its own CHECK constraints and the
 * banned-substance trigger. If this file were deleted, controlled substances
 * would still be unlistable.
 */

const GST_SLABS = [0, 500, 1200, 1800, 2800] as const;

const productSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(3).max(200),
  nameHi: z.string().trim().max(200).optional().or(z.literal("")),
  slug: z.string().trim().min(3).max(220).regex(/^[a-z0-9-]+$/, "Slug may contain lowercase letters, numbers and hyphens only."),
  brandId: z.string().max(64).optional().or(z.literal("")),
  categoryId: z.string().min(1).max(64),
  manufacturerId: z.string().min(1).max(64),
  scheduleType: z.nativeEnum(ScheduleType),
  composition: z.string().trim().min(3).max(500),
  strength: z.string().trim().max(80).optional().or(z.literal("")),
  form: z.nativeEnum(DosageForm),
  packSize: z.string().trim().min(2).max(120),
  hsnCode: z.string().trim().min(4).max(12),
  gstRateBps: z.coerce.number().int().refine((v) => GST_SLABS.includes(v as typeof GST_SLABS[number]), {
    message: "GST must be one of the Indian slabs: 0, 5, 12, 18 or 28 percent.",
  }),
  mrpPaise: z.coerce.number().int().min(1).max(100_000_000),
  sellingPricePaise: z.coerce.number().int().min(1).max(100_000_000),
  stock: z.coerce.number().int().min(0).max(1_000_000),
  maxPerOrder: z.coerce.number().int().min(1).max(100),
  shortDescription: z.string().trim().max(300).optional().or(z.literal("")),
  uses: z.string().trim().max(2000).optional().or(z.literal("")),
  howItWorks: z.string().trim().max(2000).optional().or(z.literal("")),
  directions: z.string().trim().max(2000).optional().or(z.literal("")),
  sideEffects: z.string().trim().max(2000).optional().or(z.literal("")),
  warnings: z.string().trim().max(2000).optional().or(z.literal("")),
  storage: z.string().trim().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  isRefrigerated: z.boolean().default(false),
}).refine((d) => d.sellingPricePaise <= d.mrpPaise, {
  message: "Selling price cannot exceed the MRP.",
  path: ["sellingPricePaise"],
});

export async function saveProduct(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the product details.",
    };
  }

  const admin = await requireAdmin();
  const data = parsed.data;

  try {
    // 1. Is this a class we may list at all?
    assertPermittedScheduleType(data.scheduleType);

    // 2. Is it a banned substance wearing an innocuous label?
    await assertNotBannedSubstance({
      name: data.name,
      composition: data.composition,
    });

    // 3. Does the copy make a therapeutic claim it may not?
    assertNoTherapeuticClaims({
      scheduleType: data.scheduleType,
      name: data.name,
      shortDescription: data.shortDescription || null,
      uses: data.uses || null,
      howItWorks: data.howItWorks || null,
      directions: data.directions || null,
      warnings: data.warnings || null,
    });
  } catch (error) {
    if (error instanceof BannedSubstanceError) {
      await audit({
        actorId: admin.id,
        actorRole: admin.role,
        action: "BANNED_SUBSTANCE_REJECTED",
        entityType: "Product",
        entityId: data.slug,
        metadata: {
          attemptedName: data.name,
          attemptedComposition: data.composition,
          attemptedScheduleType: data.scheduleType,
          substance: error.substance,
          reason: error.reason,
        },
      });
      return { ok: false, error: error.message };
    }

    if (error instanceof TherapeuticClaimError) {
      await audit({
        actorId: admin.id,
        actorRole: admin.role,
        action: "CLAIM_LANGUAGE_REJECTED",
        entityType: "Product",
        entityId: data.slug,
        metadata: { violations: error.violations },
      });
      return { ok: false, error: error.message };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "Product could not be saved.",
    };
  }

  const values = {
    name: data.name,
    nameHi: data.nameHi || null,
    slug: data.slug,
    brandId: data.brandId || null,
    categoryId: data.categoryId,
    manufacturerId: data.manufacturerId,
    scheduleType: data.scheduleType,
    // 4. Derived. A form field claiming otherwise is ignored, and the CHECK
    // constraint would reject the row anyway.
    requiresPrescription: requiresPrescription(data.scheduleType),
    composition: data.composition,
    strength: data.strength || null,
    form: data.form,
    packSize: data.packSize,
    hsnCode: data.hsnCode,
    gstRateBps: data.gstRateBps,
    mrpPaise: data.mrpPaise,
    sellingPricePaise: data.sellingPricePaise,
    stock: data.stock,
    maxPerOrder: data.maxPerOrder,
    shortDescription: data.shortDescription || null,
    uses: data.uses || null,
    howItWorks: data.howItWorks || null,
    directions: data.directions || null,
    sideEffects: data.sideEffects || null,
    warnings: data.warnings || null,
    storage: data.storage || null,
    isActive: data.isActive,
    isRefrigerated: data.isRefrigerated,
  };

  try {
    const saved = data.id
      ? await db.product.update({
          where: { id: data.id },
          data: values,
          select: { id: true },
        })
      : await db.product.create({
          data: { ...values, images: [`/products/${data.slug}.jpg`] },
          select: { id: true },
        });

    await audit({
      actorId: admin.id,
      actorRole: admin.role,
      action: data.id ? "PRODUCT_UPDATED" : "PRODUCT_CREATED",
      entityType: "Product",
      entityId: saved.id,
      metadata: {
        name: data.name,
        scheduleType: data.scheduleType,
        requiresPrescription: values.requiresPrescription,
      },
    });

    revalidatePath("/admin/products");
    revalidatePath(`/product/${data.slug}`);
    return { ok: true, data: { id: saved.id } };
  } catch (error) {
    // The database trigger is the backstop. If it fires, the application-layer
    // check above missed something — surface it rather than swallowing it.
    console.error("[admin] product write rejected by the database", error);
    return {
      ok: false,
      error:
        error instanceof Error && /banned substance/i.test(error.message)
          ? error.message
          : "The database refused this product. Check the schedule type, pricing and GST slab.",
    };
  }
}

const delistSchema = z.object({
  productId: z.string().min(1).max(64),
  reason: z.string().trim().min(3).max(300),
});

/**
 * Delisting rather than deletion.
 *
 * A product referenced by a dispensed order must remain resolvable, and order
 * items snapshot their own detail anyway. Delisting removes it from every
 * catalogue surface without breaking the dispensing record.
 */
export async function delistProduct(input: unknown): Promise<ActionResult> {
  const parsed = delistSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "A reason is required." };

  const admin = await requireAdmin();

  const product = await db.product.findUnique({
    where: { id: parsed.data.productId },
    select: { id: true, name: true, slug: true },
  });
  if (!product) return { ok: false, error: "Product not found." };

  await db.$transaction([
    db.product.update({
      where: { id: product.id },
      data: { isActive: false },
    }),
    // Remove it from every live cart, so nobody checks out a delisted drug.
    db.cartItem.deleteMany({ where: { productId: product.id } }),
  ]);

  await audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: "PRODUCT_DELISTED",
    entityType: "Product",
    entityId: product.id,
    metadata: { name: product.name, reason: parsed.data.reason },
  });

  revalidatePath("/admin/products");
  return { ok: true, data: undefined };
}

/**
 * Bulk CSV import.
 *
 * Runs each row through exactly the same validation as a single product save —
 * a bulk path that skips the compliance checks would be the obvious way to get
 * a banned substance into the catalogue.
 *
 * Nothing is written unless every row passes. A partially-imported catalogue is
 * harder to reason about than a rejected file.
 */
export type ImportRowError = { row: number; name: string; error: string };

export async function importProductsCsv(
  formData: FormData,
): Promise<ActionResult<{ imported: number; errors: ImportRowError[] }>> {
  const admin = await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a CSV file." };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, error: "That file is larger than 2 MB." };
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, error: "The file has no data rows." };
  }

  const header = lines[0].split(",").map((h) => h.trim());
  const required = [
    "name", "slug", "categorySlug", "manufacturerName", "scheduleType",
    "composition", "form", "packSize", "hsnCode", "gstRateBps",
    "mrpPaise", "sellingPricePaise", "stock",
  ];
  const missingColumns = required.filter((c) => !header.includes(c));
  if (missingColumns.length > 0) {
    return {
      ok: false,
      error: `The file is missing these columns: ${missingColumns.join(", ")}.`,
    };
  }

  const [categories, manufacturers, brands] = await Promise.all([
    db.category.findMany({ select: { id: true, slug: true } }),
    db.manufacturer.findMany({ select: { id: true, name: true } }),
    db.brand.findMany({ select: { id: true, name: true } }),
  ]);
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const manufacturerByName = new Map(manufacturers.map((m) => [m.name, m.id]));
  const brandByName = new Map(brands.map((b) => [b.name, b.id]));

  const errors: ImportRowError[] = [];
  const staged: z.infer<typeof productSchema>[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Deliberately simple splitting: quoted commas are not supported, and a
    // row that needs them is rejected rather than silently mangled.
    const cells = lines[i].split(",").map((c) => c.trim());
    const row = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""]));
    const name = row.name || `(row ${i + 1})`;

    const categoryId = categoryBySlug.get(row.categorySlug);
    const manufacturerId = manufacturerByName.get(row.manufacturerName);

    if (!categoryId) {
      errors.push({ row: i + 1, name, error: `Unknown category "${row.categorySlug}".` });
      continue;
    }
    if (!manufacturerId) {
      errors.push({ row: i + 1, name, error: `Unknown manufacturer "${row.manufacturerName}".` });
      continue;
    }

    const candidate = {
      ...row,
      categoryId,
      manufacturerId,
      brandId: brandByName.get(row.brandName ?? "") ?? "",
      maxPerOrder: row.maxPerOrder || 10,
      isActive: true,
      isRefrigerated: row.isRefrigerated === "true",
    };

    const parsed = productSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({
        row: i + 1,
        name,
        error: parsed.error.issues.map((iss) => iss.message).join("; "),
      });
      continue;
    }

    // Same compliance gates as a single save — no bulk bypass.
    try {
      assertPermittedScheduleType(parsed.data.scheduleType);
      await assertNotBannedSubstance({
        name: parsed.data.name,
        composition: parsed.data.composition,
      });
      assertNoTherapeuticClaims({
        scheduleType: parsed.data.scheduleType,
        name: parsed.data.name,
        shortDescription: parsed.data.shortDescription || null,
        uses: parsed.data.uses || null,
      });
    } catch (error) {
      errors.push({
        row: i + 1,
        name,
        error: error instanceof Error ? error.message : "Rejected.",
      });
      continue;
    }

    staged.push(parsed.data);
  }

  if (errors.length > 0) {
    return {
      ok: true,
      data: { imported: 0, errors },
    };
  }

  await db.$transaction(
    staged.map((d) =>
      db.product.upsert({
        where: { slug: d.slug },
        update: {
          name: d.name,
          scheduleType: d.scheduleType,
          requiresPrescription: requiresPrescription(d.scheduleType),
          composition: d.composition,
          form: d.form,
          packSize: d.packSize,
          hsnCode: d.hsnCode,
          gstRateBps: d.gstRateBps,
          mrpPaise: d.mrpPaise,
          sellingPricePaise: d.sellingPricePaise,
          stock: d.stock,
        },
        create: {
          name: d.name,
          slug: d.slug,
          categoryId: d.categoryId,
          manufacturerId: d.manufacturerId,
          brandId: d.brandId || null,
          scheduleType: d.scheduleType,
          requiresPrescription: requiresPrescription(d.scheduleType),
          composition: d.composition,
          strength: d.strength || null,
          form: d.form,
          packSize: d.packSize,
          hsnCode: d.hsnCode,
          gstRateBps: d.gstRateBps,
          mrpPaise: d.mrpPaise,
          sellingPricePaise: d.sellingPricePaise,
          stock: d.stock,
          maxPerOrder: d.maxPerOrder,
          images: [`/products/${d.slug}.jpg`],
        },
      }),
    ),
  );

  await audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: "PRODUCT_CREATED",
    entityType: "Product",
    metadata: { bulkImport: true, count: staged.length },
  });

  revalidatePath("/admin/products");
  return { ok: true, data: { imported: staged.length, errors: [] } };
}
