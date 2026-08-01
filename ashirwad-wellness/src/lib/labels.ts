import { DosageForm } from "@/generated/prisma/enums";

/**
 * Customer-facing labels for enum values.
 *
 * Kept out of the component tree so the catalogue card, the filter rail, the
 * product page and the pharmacist portal all say the same word for the same
 * thing. `Record` rather than a partial map, so adding a DosageForm member
 * fails the typecheck until it has a label.
 */
export const FORM_LABEL: Record<DosageForm, string> = {
  TABLET: "Tablet",
  CAPSULE: "Capsule",
  SYRUP: "Syrup",
  SUSPENSION: "Suspension",
  INJECTION: "Injection",
  CREAM: "Cream",
  OINTMENT: "Ointment",
  GEL: "Gel",
  DROPS: "Drops",
  INHALER: "Inhaler",
  RESPULE: "Respule",
  POWDER: "Powder",
  SACHET: "Sachet",
  SOLUTION: "Solution",
  LOTION: "Lotion",
  SPRAY: "Spray",
  SOAP: "Soap",
  PATCH: "Patch",
  DEVICE: "Device",
  OTHER: "Other",
};

export const SORT_LABEL = {
  relevance: "Relevance",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  discount: "Biggest saving",
  name: "Name (A–Z)",
} as const;
