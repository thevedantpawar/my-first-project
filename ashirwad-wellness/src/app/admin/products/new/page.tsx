import type { Metadata } from "next";

import { getProductFormOptions } from "@/lib/admin";
import { ProductForm } from "@/components/product-form";

export const metadata: Metadata = {
  title: "New product",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const options = await getProductFormOptions();
  return (
    <div>
      <h2 className="mb-4 text-base text-ink">New product</h2>
      <ProductForm options={options} />
    </div>
  );
}
