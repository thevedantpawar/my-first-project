/**
 * Money is integer paise everywhere in this codebase. Floats never touch a
 * price, a tax figure, or a total.
 *
 * These helpers exist so that the one place rounding happens is here, and so
 * that nobody is tempted to write `price / 100` inline in a component.
 */

/** 100 paise = 1 rupee. */
const PAISE_PER_RUPEE = 100;

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₹1,04.55" style Indian grouping. Use for all customer-visible prices. */
export function formatPaise(paise: number): string {
  return inrFormatter.format(paiseToRupees(paise));
}

/** Drops the decimals when the amount is whole rupees — used on dense surfaces. */
export function formatPaiseCompact(paise: number): string {
  const whole = paise % PAISE_PER_RUPEE === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paiseToRupees(paise));
}

export function discountPercent(mrpPaise: number, sellingPricePaise: number): number {
  if (mrpPaise <= 0 || sellingPricePaise >= mrpPaise) return 0;
  return Math.round(((mrpPaise - sellingPricePaise) / mrpPaise) * 100);
}

export function savingsPaise(mrpPaise: number, sellingPricePaise: number): number {
  return Math.max(0, mrpPaise - sellingPricePaise);
}

/**
 * GST is stored as basis points (1200 = 12%). Indian pharmacy pricing is
 * inclusive-of-tax: the printed MRP already contains GST, so the tax component
 * is extracted from the line total rather than added on top.
 */
export function gstComponentPaise(lineTotalPaise: number, gstRateBps: number): number {
  const rate = gstRateBps / 10_000;
  return Math.round(lineTotalPaise - lineTotalPaise / (1 + rate));
}

export function formatGstRate(gstRateBps: number): string {
  return `${gstRateBps / 100}%`;
}
