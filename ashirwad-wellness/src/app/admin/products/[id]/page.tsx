import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { db } from "@/lib/db";
import { getProductFormOptions } from "@/lib/admin";
import { ProductForm } from "@/components/product-form";

export const metadata: Metadata = {
  title: "Edit product",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [product, options] = await Promise.all([
    db.product.findUnique({ where: { id } }),
    getProductFormOptions(),
  ]);

  if (!product) notFound();

  return (
    <div>
      <h2 className="mb-4 text-base text-ink">{product.name}</h2>
      <ProductForm options={options} existing={product} />
    </div>
  );
}
