import { z } from 'zod';
import { CTA_TYPES, POST_TYPES } from '../agents/linkedin-content-agent/strategy.js';

/**
 * The content package the model must return. Shape errors are rejected here;
 * editorial rules live in the quality gate so their failures are reported as
 * human-readable reasons rather than schema noise.
 */
export const contentPackageSchema = z.object({
  postType: z.enum(POST_TYPES),
  topic: z.string().min(3),
  targetAudience: z.string().min(3),
  painSignal: z.string().default(''),
  dreamSignal: z.string().default(''),
  pointOfView: z.string().min(3),
  researchSource: z.string().min(3),
  linkedinHook: z.string().min(3),
  linkedinPost: z.string().min(1),
  ctaType: z.enum(CTA_TYPES),
  ctaText: z.string().min(3),
  publicResourceUrl: z.string().default(''),
  needsImage: z.boolean(),
  imagePrompt: z.string().default(''),
  authenticitySource: z.string().default(''),
});

export type ContentPackage = z.infer<typeof contentPackageSchema>;

export const WORKFLOW_STATUSES = [
  'generated',
  'quality_blocked',
  'dry_run',
  'published',
  'partially_published',
  'failed',
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export type ImageStatus =
  | 'not_requested'
  | 'prepared_not_attached'
  | 'generation_failed'
  | 'upload_failed'
  | 'attached';

export interface QualityResult {
  passed: boolean;
  failReasons: string[];
  wordCount: number;
  qualityScore: number;
  unsupportedAutomationDetected: boolean;
  content: ContentPackage | null;
}

/**
 * Parses a raw model response into a content package.
 * Throws nothing — callers decide how to report the failure.
 */
export function parseContentPackage(
  input: unknown,
): { ok: true; content: ContentPackage } | { ok: false; reasons: string[] } {
  const result = contentPackageSchema.safeParse(input);
  if (result.success) return { ok: true, content: result.data };
  return {
    ok: false,
    reasons: result.error.issues.map(
      (issue) => `Model output field "${issue.path.join('.') || '(root)'}": ${issue.message}`,
    ),
  };
}
