import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { getConfig } from '../../config.js';

export const POST_TYPES = [
  'Named Problem',
  'Surfaced Problem/Audit',
  'Deep Work System',
  'Founder/Practitioner Story',
  'Point-of-View',
  'Lead Magnet',
  'Profile View Outreach',
] as const;

export type PostType = (typeof POST_TYPES)[number];

export const CTA_TYPES = [
  'follow',
  'repost',
  'save',
  'profile',
  'resource',
  'case_study',
  'calendar',
] as const;

export type CtaType = (typeof CTA_TYPES)[number];

const beliefSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  opposingBelief: z.string().min(1),
  evidenceAngles: z.array(z.string().min(1)).min(1),
});

const pointOfViewSchema = z.object({
  beliefs: z.array(beliefSchema).min(1),
});

const signalSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  buyerSituation: z.string().min(1),
});

const signalLibrarySchema = z.object({ signals: z.array(signalSchema).min(1) });

const audienceSchema = z.object({
  primaryAudience: z.array(z.string().min(1)).min(1),
  positioning: z.object({
    company: z.string().min(1),
    operator: z.string().min(1),
    summary: z.string().min(1),
    focus: z.array(z.string().min(1)).min(1),
  }),
  rejectTopics: z.array(z.string().min(1)).min(1),
  growthTarget: z.object({
    followers: z.number().int().positive(),
    months: z.number().int().positive(),
    guaranteed: z.literal(false),
    note: z.string().min(1),
  }),
});

const portfolioSchema = z.object({
  timezone: z.string().min(1),
  postsPerDay: z.number().int().positive(),
  weekday: z.record(z.string(), z.enum(POST_TYPES)),
  fridayAlternate: z.enum(POST_TYPES),
  rollingWindowWeeks: z.number().int().positive(),
  targetMix: z.record(z.enum(POST_TYPES), z.number().min(0).max(100)),
  mixTolerancePercentagePoints: z.number().min(0).max(100),
});

const ctaSchema = z.object({
  ctaTypes: z.record(
    z.enum(CTA_TYPES),
    z.object({
      destination: z.string().nullable(),
      examples: z.array(z.string().min(1)).min(1),
    }),
  ),
  preferredByPostType: z.record(z.enum(POST_TYPES), z.array(z.enum(CTA_TYPES)).min(1)),
});

export const profileAuditSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      completed: z.boolean(),
      notes: z.string(),
    }),
  ),
  proof: z.array(
    z.object({
      id: z.string().min(1),
      claim: z.string().min(1),
      evidenceUrl: z.string(),
      recordedAt: z.string(),
    }),
  ),
});

export type PointOfViewBelief = z.infer<typeof beliefSchema>;
export type Signal = z.infer<typeof signalSchema>;
export type AudienceConfig = z.infer<typeof audienceSchema>;
export type PortfolioConfig = z.infer<typeof portfolioSchema>;
export type CtaConfig = z.infer<typeof ctaSchema>;
export type ProfileAuditConfig = z.infer<typeof profileAuditSchema>;

export interface Strategy {
  beliefs: PointOfViewBelief[];
  painSignals: Signal[];
  dreamSignals: Signal[];
  audience: AudienceConfig;
  portfolio: PortfolioConfig;
  cta: CtaConfig;
}

function readJson<T>(fileName: string, schema: z.ZodType<T>): T {
  const path = resolve(getConfig().configDir, 'strategy', fileName);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`Missing strategy configuration file: config/strategy/${fileName}`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`config/strategy/${fileName} is not valid JSON`, { cause });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`config/strategy/${fileName} is invalid: ${issues}`);
  }
  return result.data;
}

/**
 * Strategy config is read from disk on every call so an operator can edit the
 * libraries without restarting the API.
 */
export function loadStrategy(): Strategy {
  return {
    beliefs: readJson('point-of-view.json', pointOfViewSchema).beliefs,
    painSignals: readJson('pain-signals.json', signalLibrarySchema).signals,
    dreamSignals: readJson('dream-signals.json', signalLibrarySchema).signals,
    audience: readJson('audience.json', audienceSchema),
    portfolio: readJson('content-portfolio.json', portfolioSchema),
    cta: readJson('cta.json', ctaSchema),
  };
}

export function loadProfileAuditConfig(): ProfileAuditConfig {
  return readJson('profile-audit.json', profileAuditSchema);
}

export function profileAuditPath(): string {
  return resolve(getConfig().configDir, 'strategy', 'profile-audit.json');
}
