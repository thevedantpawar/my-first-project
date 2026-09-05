import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Factory,
  Package,
  Snowflake,
  Thermometer,
  Undo2,
} from "lucide-react";

import { getProductBySlug, getSaltSubstitutes } from "@/lib/catalogue";
import { formatPaise, discountPercent, savingsPaise, formatGstRate } from "@/lib/money";
import { SCHEDULE_LABEL, RX_GATE_COPY } from "@/lib/schedule";
import { FORM_LABEL } from "@/lib/labels";
import { ProductImage } from "@/components/product-image";
import { RxBadge, RxGateBlock } from "@/components/rx-gate";
import { SaltSubstitutes } from "@/components/salt-substitutes";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { ScheduleType } from "@/generated/prisma/enums";
import { pharmacy } from "@/lib/pharmacy";
import { auth } from "@/auth";
import { siteUrl, breadcrumbJsonLd } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product not found" };

  const description =
    product.shortDescription ??
    `${product.name} — ${product.composition}. ${product.packSize}.`;

  return {
    title: product.name,
    description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      type: "website",
      title: product.name,
      description,
      url: `${siteUrl()}/product/${product.slug}`,
    },
  };
}

/** Long-form PDP sections, rendered only when the product has the content. */
function InfoSection({
  title,
  body,
}: {
  title: string;
  body: string | null;
}) {
  if (!body) return null;
  return (
    <section className="border-t border-ink-100 py-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{body}</p>
    </section>
  );
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [product, session] = await Promise.all([getProductBySlug(slug), auth()]);
  if (!product) notFound();

  const substitutes = await getSaltSubstitutes(product);

  const off = discountPercent(product.mrpPaise, product.sellingPricePaise);
  const saved = savingsPaise(product.mrpPaise, product.sellingPricePaise);
  const isRx = product.requiresPrescription;
  const isH1 = product.scheduleType === ScheduleType.SCHEDULE_H1;
  const outOfStock = product.stock <= 0;

  // JSON-LD. `availability` reflects real stock, and prescription products are
  // still marked as offered — the gate is a fulfilment condition, not an
  // absence of the product.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription ?? product.composition,
    sku: product.id,
    brand: product.brand ? { "@type": "Brand", name: product.brand.name } : undefined,
    manufacturer: { "@type": "Organization", name: product.manufacturer.name },
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: (product.sellingPricePaise / 100).toFixed(2),
      availability: outOfStock
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
      seller: { "@type": "Pharmacy", name: pharmacy.tradeName },
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([
              { name: "Home", path: "/" },
              ...(product.category.parent
                ? [{
                    name: product.category.parent.name,
                    path: `/category/${product.category.parent.slug}`,
                  }]
                : []),
              { name: product.category.name, path: `/category/${product.category.slug}` },
              { name: product.name, path: `/product/${product.slug}` },
            ]),
          ),
        }}
      />

      <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
        <Link href="/" className="hover:text-living-600">
          Home
        </Link>
        {product.category.parent && (
          <>
            <span aria-hidden="true"> / </span>
            <Link
              href={`/category/${product.category.parent.slug}`}
              className="hover:text-living-600"
            >
              {product.category.parent.name}
            </Link>
          </>
        )}
        <span aria-hidden="true"> / </span>
        <Link
          href={`/category/${product.category.slug}`}
          className="hover:text-living-600"
        >
          {product.category.name}
        </Link>
      </nav>

      <div className="mt-4 gap-8 lg:grid lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Gallery */}
        <div className="lg:sticky lg:top-32 lg:self-start">
          <div
            className={`relative aspect-square overflow-hidden rounded-[var(--radius-card)] border border-ink-100 ${
              isRx ? "rx-gate" : "bg-paper-raised"
            }`}
          >
            <ProductImage
              src={product.images[0]}
              name={product.brand?.name ?? product.name}
              slug={product.slug}
              label={FORM_LABEL[product.form]}
            />
            {isRx && (
              <div className="absolute left-3 top-3">
                <RxBadge />
              </div>
            )}
          </div>

          {product.images.length > 1 && (
            <ul className="mt-3 flex gap-2">
              {product.images.slice(0, 4).map((image, i) => (
                <li
                  key={image}
                  className="size-16 overflow-hidden rounded-[var(--radius-control)] border border-ink-100 bg-paper-sunk"
                >
                  <ProductImage
                    src={image}
                    name={`${product.name} view ${i + 1}`}
                    slug={`${product.slug}-${i}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div className="mt-6 min-w-0 lg:mt-0">
          <p className="text-xs text-ink-500">{product.brand?.name}</p>
          <h1 className="mt-0.5 text-2xl leading-tight text-ink sm:text-3xl">
            {product.name}
          </h1>
          {product.nameHi && (
            <p className="font-devanagari mt-1 text-base text-ink-500">
              {product.nameHi}
            </p>
          )}

          <p className="identifier mt-2 text-sm text-ink-700">
            {product.composition}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-pine-50 px-2 py-0.5 text-pine-700">
              {SCHEDULE_LABEL[product.scheduleType]}
            </span>
            <span className="rounded-full bg-paper-sunk px-2 py-0.5 text-ink-700">
              {FORM_LABEL[product.form]}
            </span>
            {product.isRefrigerated && (
              <span className="flex items-center gap-1 rounded-full bg-pine-50 px-2 py-0.5 text-pine-700">
                <Snowflake aria-hidden="true" className="size-3" />
                Cold chain
              </span>
            )}
          </div>

          {/* Price */}
          <div className="mt-5 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="identifier text-2xl font-semibold text-pine-700">
                {formatPaise(product.sellingPricePaise)}
              </span>
              {off > 0 && (
                <>
                  <span className="identifier text-base text-ink-300 line-through">
                    {formatPaise(product.mrpPaise)}
                  </span>
                  <span className="rounded-full bg-turmeric-100 px-2 py-0.5 text-xs font-bold text-turmeric-600">
                    {off}% off
                  </span>
                </>
              )}
            </div>

            {saved > 0 && (
              <p className="mt-1 text-sm font-semibold text-savings">
                You save {formatPaise(saved)}
              </p>
            )}

            <p className="mt-1 text-xs text-ink-500">
              {product.packSize} · inclusive of all taxes (GST{" "}
              <span className="identifier">{formatGstRate(product.gstRateBps)}</span>
              )
            </p>

            <div className="mt-4">
              {outOfStock ? (
                <button
                  type="button"
                  disabled
                  className="w-full cursor-not-allowed rounded-[var(--radius-control)] bg-ink-100 px-5 py-3 text-sm font-semibold text-ink-300"
                >
                  Out of stock
                </button>
              ) : (
                <AddToCartButton
                  productId={product.id}
                  isSignedIn={Boolean(session?.user?.id)}
                />
              )}
            </div>
          </div>

          {/* The Rx Gate — third of the four surfaces. */}
          {isRx && (
            <div className="mt-4">
              <RxGateBlock scheduleType={product.scheduleType} tone="long" />
            </div>
          )}

          {isH1 && (
            <div className="mt-3 flex gap-2 rounded-[var(--radius-control)] border border-rx-100 bg-rx-50 p-3">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-rx-500"
              />
              {/* The Rx Gate block above already carries the Rule 65(11A)
                  citation for H1 items. This block adds only what it does not
                  say — what is recorded, and for how long. */}
              <p className="text-xs leading-relaxed text-rx-700">
                <strong className="font-semibold">Schedule H1 medicine.</strong>{" "}
                Your prescriber&rsquo;s name and registration number, the
                patient&rsquo;s name, and the quantity supplied are entered in a
                statutory register that is retained for three years and is open
                to inspection by the drug authorities.
              </p>
            </div>
          )}

          {/* Key facts */}
          <dl className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            {[
              { icon: Factory, label: "Manufacturer", value: product.manufacturer.name },
              { icon: Package, label: "Pack size", value: product.packSize },
              product.strength
                ? { icon: Thermometer, label: "Strength", value: product.strength }
                : null,
            ]
              .filter((x): x is { icon: typeof Factory; label: string; value: string } => !!x)
              .map((fact) => (
                <div
                  key={fact.label}
                  className="rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised p-2.5"
                >
                  <dt className="flex items-center gap-1 text-ink-300">
                    <fact.icon aria-hidden="true" className="size-3" />
                    {fact.label}
                  </dt>
                  <dd className="mt-0.5 text-ink-700">{fact.value}</dd>
                </div>
              ))}
          </dl>

          {/* Long-form content */}
          <div className="mt-6">
            <InfoSection title="Uses" body={product.uses} />
            <InfoSection title="How it works" body={product.howItWorks} />
            <InfoSection title="Directions for use" body={product.directions} />
            <InfoSection title="Side effects" body={product.sideEffects} />
            <InfoSection title="Safety warnings" body={product.warnings} />
            <InfoSection title="Storage" body={product.storage} />

            <section className="border-t border-ink-100 py-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Undo2 aria-hidden="true" className="size-3.5" />
                Expiry and returns
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
                {product.expiryPolicy}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
                {product.isReturnable
                  ? "Returnable within 7 days if the pack is unopened and the batch and expiry are intact."
                  : "Medicines cannot be returned once dispensed, in the interest of the safety of other patients. Contact us immediately if you receive a damaged or incorrect item."}
              </p>
            </section>

            {product.salts.length > 0 && (
              <section className="border-t border-ink-100 py-4">
                <h2 className="text-sm font-semibold text-ink">
                  Active ingredients
                </h2>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {product.salts.map((ps) => (
                    <li key={ps.saltId}>
                      <Link
                        href={`/salt/${ps.salt.slug}`}
                        className="identifier rounded-full border border-ink-100 px-2.5 py-1 text-xs text-ink-700 hover:border-living-500 hover:text-living-600"
                      >
                        {ps.salt.name} {ps.strength}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>

      {substitutes.length > 0 && (
        <div className="mt-8">
          <SaltSubstitutes
            substitutes={substitutes}
            currentPricePaise={product.sellingPricePaise}
            composition={product.composition}
          />
        </div>
      )}

      <p className="mt-8 rounded-[var(--radius-control)] bg-paper-sunk p-3 text-xs leading-relaxed text-ink-500">
        {isRx ? RX_GATE_COPY.long + " " : ""}
        This information is for reference and does not replace advice from a
        qualified medical practitioner. Always read the label.
      </p>
    </div>
  );
}
