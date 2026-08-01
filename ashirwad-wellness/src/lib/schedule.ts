import { ScheduleType } from "@/generated/prisma/enums";

/**
 * The single source of truth for what "prescription required" means.
 *
 * Nothing in this codebase may hardcode a list of Rx schedule types. If the
 * regulatory position ever changes, it changes here and the CHECK constraint
 * in the migration changes with it — nowhere else.
 */
const RX_SCHEDULES: ReadonlySet<ScheduleType> = new Set([
  ScheduleType.SCHEDULE_H,
  ScheduleType.SCHEDULE_H1,
]);

/** Mirrors the products_requires_prescription_derived CHECK constraint. */
export function requiresPrescription(scheduleType: ScheduleType): boolean {
  return RX_SCHEDULES.has(scheduleType);
}

/** Schedule H1 additionally requires a register entry under Rule 65(11A). */
export function requiresH1Register(scheduleType: ScheduleType): boolean {
  return scheduleType === ScheduleType.SCHEDULE_H1;
}

export function isRxSchedule(scheduleType: ScheduleType): boolean {
  return requiresPrescription(scheduleType);
}

/**
 * Product classes for which therapeutic claims are prohibited. Drugs may state
 * what they treat; nutraceuticals, cosmetics and (in commerce copy) ayurvedic
 * products may not.
 */
const CLAIM_RESTRICTED: ReadonlySet<ScheduleType> = new Set([
  ScheduleType.NUTRACEUTICAL,
  ScheduleType.COSMETIC,
  ScheduleType.AYURVEDIC,
]);

export function isClaimRestricted(scheduleType: ScheduleType): boolean {
  return CLAIM_RESTRICTED.has(scheduleType);
}

/** Customer-facing label. Deliberately plain — no euphemism for "Rx only". */
export const SCHEDULE_LABEL: Record<ScheduleType, string> = {
  OTC: "Over the counter",
  SCHEDULE_H: "Schedule H — prescription required",
  SCHEDULE_H1: "Schedule H1 — prescription required",
  AYURVEDIC: "Ayurvedic",
  COSMETIC: "Cosmetic",
  NUTRACEUTICAL: "Nutraceutical / supplement",
  DEVICE: "Medical device",
};

/**
 * The Rx Gate sentence. One string, used verbatim on the catalogue card, the
 * product page, the cart line and the checkout line. Consistency is the point:
 * a returning customer should recognise it without reading it.
 */
export const RX_GATE_COPY = {
  badge: "℞ Prescription",
  short: "Prescription required",
  long: "This medicine requires a valid prescription. Upload one at checkout — a registered pharmacist will verify it before your order is dispensed.",
  cartNotice: "Cannot be dispensed until a pharmacist verifies your prescription.",
  // Shown once the gate is satisfied. cartNotice must never appear on a line
  // that already carries a verified prescription — it would be stating
  // something untrue about the customer's own order, on the one element of
  // this interface that has to be exactly honest. The second sentence is not
  // hedging: passing the gate proves a verified prescription is attached, and
  // a pharmacist still has to confirm it covers this drug at this quantity.
  cartVerified:
    "Verified prescription attached. A pharmacist checks that it covers this item before your order is dispatched.",
  blocked: "A pharmacist-verified prescription is required before this order can be paid for.",
} as const;

/** Statutory citation shown alongside H1 items and in the pharmacist portal. */
export const H1_CITATION =
  "Rule 65(11A), Drugs and Cosmetics Rules 1945 — supply recorded in the Schedule H1 register.";
