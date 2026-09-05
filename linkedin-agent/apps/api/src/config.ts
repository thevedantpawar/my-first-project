import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Repository root, resolved from this file rather than process.cwd(), so the
 * API loads the same .env whether it is started from the repo root, from
 * apps/api, or from dist/.
 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let envLoaded = false;

/**
 * Loads `linkedin-agent/.env` exactly once. Existing process env always wins.
 *
 * `SKIP_DOTENV=true` disables the read entirely. Tests set it so the suite
 * behaves identically whether or not the machine running it happens to have a
 * populated .env on disk.
 */
export function loadEnvFile(): void {
  if (envLoaded) return;
  envLoaded = true;
  if (process.env.SKIP_DOTENV === 'true') return;
  const envPath = resolve(REPO_ROOT, '.env');
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
  }
}

const booleanish = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim().toLowerCase() === 'true');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim());

const intWithDefault = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = (value ?? '').trim();
      if (trimmed === '') return fallback;
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isNaN(parsed) ? fallback : parsed;
    })
    .refine((value) => value >= min && value <= max, {
      message: `must be an integer between ${min} and ${max}`,
    });

const envSchema = z.object({
  NODE_ENV: z.string().optional().transform((v) => (v ?? 'development').trim()),
  PORT: intWithDefault(3001, 1, 65535),
  APP_BASE_URL: optionalString,

  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().optional().transform((v) => ((v ?? '').trim() || 'gemini-3.6-flash')),
  GEMINI_IMAGE_MODEL: z
    .string()
    .optional()
    .transform((v) => ((v ?? '').trim() || 'gemini-2.5-flash-image')),

  TAVILY_API_KEY: optionalString,
  CONTENT_RESEARCH_QUERY: z
    .string()
    .optional()
    .transform(
      (v) =>
        (v ?? '').trim() ||
        'AI agents automation Claude Gemini OpenAI agentic workflows B2B automation news',
    ),

  LINKEDIN_ACCESS_TOKEN: optionalString,
  LINKEDIN_PERSON_URN: optionalString,
  LINKEDIN_API_VERSION: z.string().optional().transform((v) => ((v ?? '').trim() || '202506')),
  LINKEDIN_ENABLE_IMAGE_UPLOAD: booleanish,

  GOOGLE_SHEETS_ID: optionalString,
  GOOGLE_SHEETS_ACCESS_TOKEN: optionalString,
  GOOGLE_SHEETS_PUBLISHED_SHEET: z
    .string()
    .optional()
    .transform((v) => ((v ?? '').trim() || 'published')),
  GOOGLE_SHEETS_BLOCKED_SHEET: z
    .string()
    .optional()
    .transform((v) => ((v ?? '').trim() || 'blocked')),

  SOCIAL_CONTENT_SCHEDULER_ENABLED: booleanish,
  SOCIAL_CONTENT_RUN_HOUR: intWithDefault(21, 0, 23),
  SOCIAL_CONTENT_RUN_MINUTE: intWithDefault(0, 0, 59),
  SOCIAL_CONTENT_DRY_RUN: z
    .string()
    .optional()
    .transform((value) => (value ?? '').trim().toLowerCase() !== 'false'),

  CONTENT_MIN_WORDS: intWithDefault(150, 80, 400),
  CONTENT_MAX_WORDS: intWithDefault(220, 80, 400),

  PROFILE_URL: optionalString,
  PUBLIC_RESOURCE_URL: optionalString,
  CASE_STUDY_URL: optionalString,
  CALENDAR_URL: optionalString,

  DATA_DIR: z.string().optional().transform((v) => ((v ?? '').trim() || './data')),
});

export type AppConfig = z.infer<typeof envSchema> & {
  dataDir: string;
  configDir: string;
};

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  loadEnvFile();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const values = parsed.data;
  if (values.CONTENT_MIN_WORDS > values.CONTENT_MAX_WORDS) {
    throw new Error('Invalid environment configuration: CONTENT_MIN_WORDS exceeds CONTENT_MAX_WORDS');
  }
  cached = {
    ...values,
    dataDir: isAbsolute(values.DATA_DIR) ? values.DATA_DIR : resolve(REPO_ROOT, values.DATA_DIR),
    configDir: resolve(REPO_ROOT, 'config'),
  };
  return cached;
}

/** Test helper: forces the next getConfig() to re-read process.env. */
export function resetConfigCache(): void {
  cached = null;
  envLoaded = false;
}

export interface ProviderReadiness {
  gemini: boolean;
  tavily: boolean;
  linkedin: boolean;
  googleSheets: boolean;
}

/**
 * Whether each provider has enough configuration to be used. Never returns any
 * part of a credential — only whether one is present.
 */
export function providerReadiness(config: AppConfig = getConfig()): ProviderReadiness {
  return {
    gemini: config.GEMINI_API_KEY !== '',
    tavily: config.TAVILY_API_KEY !== '',
    linkedin:
      config.LINKEDIN_ACCESS_TOKEN !== '' &&
      config.LINKEDIN_PERSON_URN.startsWith('urn:li:person:'),
    googleSheets: config.GOOGLE_SHEETS_ID !== '' && config.GOOGLE_SHEETS_ACCESS_TOKEN !== '',
  };
}

/** Public destination URLs a CTA may point at, keyed by cta.json destination. */
export function destinationUrls(config: AppConfig = getConfig()): Record<string, string> {
  return {
    PROFILE_URL: config.PROFILE_URL,
    PUBLIC_RESOURCE_URL: config.PUBLIC_RESOURCE_URL,
    CASE_STUDY_URL: config.CASE_STUDY_URL,
    CALENDAR_URL: config.CALENDAR_URL,
  };
}
