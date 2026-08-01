import { describe, it, expect } from "vitest";

import { lintProductClaims, assertNoTherapeuticClaims, TherapeuticClaimError } from "@/lib/claims";
import { requiresPrescription, requiresH1Register, isClaimRestricted } from "@/lib/schedule";
import { gstComponentPaise, discountPercent, rupeesToPaise, formatPaise } from "@/lib/money";
import { ScheduleType } from "@/generated/prisma/enums";

/**
 * Unit-level compliance tests. The database-level guarantees are tested
 * separately in prisma/sql/constraint_tests.sql; these cover the logic that
 * runs before a write is attempted.
 */

describe("prescription derivation", () => {
  it("requires a prescription for exactly Schedule H and H1", () => {
    expect(requiresPrescription(ScheduleType.SCHEDULE_H)).toBe(true);
    expect(requiresPrescription(ScheduleType.SCHEDULE_H1)).toBe(true);

    expect(requiresPrescription(ScheduleType.OTC)).toBe(false);
    expect(requiresPrescription(ScheduleType.AYURVEDIC)).toBe(false);
    expect(requiresPrescription(ScheduleType.COSMETIC)).toBe(false);
    expect(requiresPrescription(ScheduleType.NUTRACEUTICAL)).toBe(false);
    expect(requiresPrescription(ScheduleType.DEVICE)).toBe(false);
  });

  it("matches the derivation for every schedule type without exception", () => {
    // Guards against a new enum member being added without a decision about
    // whether it is prescription-gated.
    for (const type of Object.values(ScheduleType)) {
      const expected = type === "SCHEDULE_H" || type === "SCHEDULE_H1";
      expect(requiresPrescription(type)).toBe(expected);
    }
  });

  it("requires the H1 register only for Schedule H1", () => {
    expect(requiresH1Register(ScheduleType.SCHEDULE_H1)).toBe(true);
    expect(requiresH1Register(ScheduleType.SCHEDULE_H)).toBe(false);
    expect(requiresH1Register(ScheduleType.OTC)).toBe(false);
  });
});

describe("therapeutic claim linter", () => {
  it("rejects cure, treat and prevent claims on a nutraceutical", () => {
    const violations = lintProductClaims({
      scheduleType: ScheduleType.NUTRACEUTICAL,
      uses: "Cures fatigue and treats weakness. Prevents illness.",
    });

    expect(violations.length).toBeGreaterThanOrEqual(3);
    expect(violations.map((v) => v.matched.toLowerCase())).toEqual(
      expect.arrayContaining(["cures", "treats", "prevents"]),
    );
  });

  it("rejects naming a disease in cosmetic copy", () => {
    const violations = lintProductClaims({
      scheduleType: ScheduleType.COSMETIC,
      shortDescription: "Helps with diabetes-related skin problems.",
    });
    expect(violations.some((v) => /disease condition/.test(v.reason))).toBe(true);
  });

  it("rejects absolute safety and efficacy guarantees", () => {
    expect(
      lintProductClaims({
        scheduleType: ScheduleType.AYURVEDIC,
        warnings: "100% safe with no side effects.",
      }).length,
    ).toBeGreaterThan(0);

    expect(
      lintProductClaims({
        scheduleType: ScheduleType.AYURVEDIC,
        uses: "A miracle remedy, guaranteed results.",
      }).length,
    ).toBeGreaterThan(0);
  });

  it("exempts drugs — a medicine must be able to state what it treats", () => {
    const drugCopy = {
      uses: "Treats bacterial infections. Prevents recurrence of rheumatic fever.",
    };

    expect(lintProductClaims({ ...drugCopy, scheduleType: ScheduleType.SCHEDULE_H })).toEqual([]);
    expect(lintProductClaims({ ...drugCopy, scheduleType: ScheduleType.OTC })).toEqual([]);
    expect(lintProductClaims({ ...drugCopy, scheduleType: ScheduleType.DEVICE })).toEqual([]);
  });

  it("accepts compliant structure-function wording", () => {
    expect(
      lintProductClaims({
        scheduleType: ScheduleType.NUTRACEUTICAL,
        uses: "A dietary source of vitamin C, which contributes to the normal function of the immune system.",
      }),
    ).toEqual([]);
  });

  it("throws with actionable detail from the assert helper", () => {
    expect(() =>
      assertNoTherapeuticClaims({
        scheduleType: ScheduleType.COSMETIC,
        uses: "Cures acne.",
      }),
    ).toThrow(TherapeuticClaimError);
  });

  it("marks the right product classes as claim-restricted", () => {
    expect(isClaimRestricted(ScheduleType.NUTRACEUTICAL)).toBe(true);
    expect(isClaimRestricted(ScheduleType.COSMETIC)).toBe(true);
    expect(isClaimRestricted(ScheduleType.AYURVEDIC)).toBe(true);
    expect(isClaimRestricted(ScheduleType.OTC)).toBe(false);
    expect(isClaimRestricted(ScheduleType.SCHEDULE_H)).toBe(false);
  });
});

describe("money", () => {
  it("keeps everything in integer paise", () => {
    expect(rupeesToPaise(31)).toBe(3100);
    expect(rupeesToPaise(27.9)).toBe(2790);
    expect(Number.isInteger(rupeesToPaise(104.55))).toBe(true);
  });

  it("extracts GST from an inclusive price rather than adding it on top", () => {
    // ₹112 inclusive of 12% GST -> ₹12 tax component.
    expect(gstComponentPaise(11200, 1200)).toBe(1200);
  });

  it("computes discount percentage", () => {
    expect(discountPercent(3100, 2790)).toBe(10);
    expect(discountPercent(3100, 3100)).toBe(0);
    expect(discountPercent(0, 0)).toBe(0);
  });

  it("formats with Indian digit grouping", () => {
    expect(formatPaise(198500)).toContain("1,985");
  });
});
