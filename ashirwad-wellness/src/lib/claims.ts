import { ScheduleType } from "@/generated/prisma/enums";
import { isClaimRestricted } from "./schedule";

/**
 * Therapeutic-claim linter.
 *
 * The Drugs and Magic Remedies (Objectionable Advertisements) Act 1954 and the
 * FSSAI advertising regulations prohibit claiming that a nutraceutical,
 * cosmetic or ayurvedic product cures, treats or prevents disease. Drugs may
 * state their indications; these product classes may not.
 *
 * This runs at the product write boundary, so non-compliant copy cannot be
 * saved — not merely flagged on a dashboard someone reads later.
 */

type ClaimRule = {
  /** Matched case-insensitively against the copy. */
  pattern: RegExp;
  /** Shown to the admin who tried to save it. */
  reason: string;
  /** A compliant way to say the intended thing. */
  suggestion: string;
};

const CLAIM_RULES: readonly ClaimRule[] = [
  {
    pattern: /\bcures?\b|\bcured\b|\bcuring\b/i,
    reason: "'cure' is a therapeutic claim",
    suggestion: "Describe the ingredient, not an outcome — e.g. 'contains zinc'.",
  },
  {
    pattern: /\btreats?\b|\btreated\b|\btreating\b|\btreatment for\b/i,
    reason: "'treat' is a therapeutic claim",
    suggestion: "Use 'traditionally used in' or state the composition instead.",
  },
  {
    pattern: /\bprevents?\b|\bprevention of\b|\bpreventing\b/i,
    reason: "'prevent' is a disease-prevention claim",
    suggestion: "Use 'supports' or 'helps maintain' with a normal-function claim.",
  },
  {
    pattern: /\bheals?\b|\bhealing\b/i,
    reason: "'heal' is a therapeutic claim",
    suggestion: "Describe the product's composition or intended cosmetic effect.",
  },
  {
    pattern: /\bremed(y|ies)\b/i,
    reason: "'remedy' implies a therapeutic effect",
    suggestion: "Describe the traditional use without implying efficacy.",
  },
  {
    pattern: /\bmiracle\b|\bmagical?\b|\bguaranteed\b/i,
    reason: "efficacy guarantee — prohibited under the Magic Remedies Act 1954",
    suggestion: "Remove the guarantee. Claims of certain efficacy are not permitted.",
  },
  {
    pattern: /\b(?:reverses?|eliminates?|eradicates?)\b/i,
    reason: "implies disease reversal",
    suggestion: "Use 'supports' or 'helps maintain'.",
  },
  {
    pattern:
      /\b(?:cancer|diabetes|diabetic|hypertension|asthma|arthritis|covid|tuberculosis|infertility|obesity|hiv|aids)\b/i,
    reason: "names a disease condition — implies a therapeutic indication",
    suggestion:
      "Do not name a disease. State the nutrient and its normal-function role instead.",
  },
  {
    pattern: /\b(?:100%\s*safe|no side ?effects?|zero side ?effects?)\b/i,
    reason: "absolute safety claim",
    suggestion: "Safety cannot be stated in absolute terms.",
  },
  {
    pattern: /\b(?:doctor|clinically)\s+(?:recommended|proven|approved)\b/i,
    reason: "unsubstantiated endorsement claim",
    suggestion: "Remove, or cite the specific study in the description body.",
  },
];

export type ClaimViolation = {
  field: string;
  matched: string;
  reason: string;
  suggestion: string;
};

/** Fields whose copy is customer-facing and therefore in scope. */
const LINTED_FIELDS = [
  "name",
  "shortDescription",
  "uses",
  "howItWorks",
  "directions",
  "warnings",
] as const;

export type LintableProduct = Partial<
  Record<(typeof LINTED_FIELDS)[number], string | null | undefined>
> & {
  scheduleType: ScheduleType;
};

/**
 * Returns every claim violation in the product's copy. Empty array means the
 * copy is clean. Drugs (OTC / Schedule H / H1 / devices) are exempt — stating
 * what a medicine treats is not merely permitted, it is required.
 */
export function lintProductClaims(product: LintableProduct): ClaimViolation[] {
  if (!isClaimRestricted(product.scheduleType)) return [];

  const violations: ClaimViolation[] = [];

  for (const field of LINTED_FIELDS) {
    const copy = product[field];
    if (!copy) continue;

    for (const rule of CLAIM_RULES) {
      const match = copy.match(rule.pattern);
      if (match) {
        violations.push({
          field,
          matched: match[0],
          reason: rule.reason,
          suggestion: rule.suggestion,
        });
      }
    }
  }

  return violations;
}

export class TherapeuticClaimError extends Error {
  readonly violations: ClaimViolation[];

  constructor(violations: ClaimViolation[]) {
    const detail = violations
      .map((v) => `${v.field}: "${v.matched}" — ${v.reason}. ${v.suggestion}`)
      .join("\n");
    super(`Product copy contains prohibited therapeutic claims:\n${detail}`);
    this.name = "TherapeuticClaimError";
    this.violations = violations;
  }
}

/** Throws unless the copy is clean. Called from the product write path. */
export function assertNoTherapeuticClaims(product: LintableProduct): void {
  const violations = lintProductClaims(product);
  if (violations.length > 0) {
    throw new TherapeuticClaimError(violations);
  }
}
