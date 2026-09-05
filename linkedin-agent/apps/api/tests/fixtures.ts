import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfigCache } from '../src/config.js';
import type { ContentPackage } from '../src/validation/linkedin-content-schema.js';

export const VALID_HOOK = 'Your automation fails before the model runs.';

const CORE_SENTENCES = [
  'Most operations teams test the happy path once and ship the workflow.',
  'But the retry runs without state, so one failed step repeats the same action twice.',
  'Nobody sees it until a customer does.',
  'The fix is small. Give every step an idempotency key, store the run state, and monitor the failure path instead of the success path.',
  'Then decide what a second attempt is allowed to touch.',
];

export const VALID_CTA = 'Save this for your next workflow review.';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

const FILLER_POOL = [
  'teams',
  'review',
  'the',
  'process',
  'each',
  'week',
  'and',
  'record',
  'what',
  'changed',
];

function filler(words: number): string {
  if (words <= 0) return '';
  const tokens = Array.from({ length: words }, (_, index) => FILLER_POOL[index % FILLER_POOL.length]);
  const sentence = tokens.join(' ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * Builds a post with an exact word count that satisfies every editorial rule
 * except the one a test is deliberately breaking.
 */
export function makePost(
  targetWords: number,
  options: { hook?: string; cta?: string; extra?: string } = {},
): string {
  const hook = options.hook ?? VALID_HOOK;
  const cta = options.cta ?? VALID_CTA;
  const extra = options.extra ?? '';
  const fixed = [hook, ...CORE_SENTENCES, extra, cta].filter((line) => line !== '');
  const used = fixed.reduce((total, line) => total + countWords(line), 0);
  const padding = filler(targetWords - used);
  const body = padding === '' ? CORE_SENTENCES : [...CORE_SENTENCES, padding];
  return [hook, '', ...body, ...(extra ? ['', extra] : []), '', cta].join('\n');
}

export function makeContent(overrides: Partial<ContentPackage> = {}): ContentPackage {
  const post = overrides.linkedinPost ?? makePost(180);
  return {
    postType: 'Surfaced Problem/Audit',
    topic: 'retry semantics in internal lead-routing workflows',
    targetAudience: 'operations leads at US service businesses running an internal automation',
    painSignal: 'retries create duplicate actions or surprise bills',
    dreamSignal: 'workflows that recover from failure',
    pointOfView: 'orchestration-over-model',
    researchSource: 'Practitioner experience plus vendor documentation reviewed 2026-02-10',
    linkedinHook: VALID_HOOK,
    linkedinPost: post,
    ctaType: 'save',
    ctaText: VALID_CTA,
    publicResourceUrl: '',
    needsImage: false,
    imagePrompt: '',
    authenticitySource: '',
    ...overrides,
  };
}

/** Points DATA_DIR at a throwaway directory so tests never touch real state. */
export function useTemporaryDataDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'linkedin-agent-test-'));
  process.env.DATA_DIR = dir;
  resetConfigCache();
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATA_DIR;
      resetConfigCache();
    },
  };
}

/** Baseline env for tests: nothing configured unless a test opts in. */
export function clearProviderEnv(): void {
  for (const key of [
    'GEMINI_API_KEY',
    'TAVILY_API_KEY',
    'LINKEDIN_ACCESS_TOKEN',
    'LINKEDIN_PERSON_URN',
    'GOOGLE_SHEETS_ID',
    'GOOGLE_SHEETS_ACCESS_TOKEN',
    'PROFILE_URL',
    'PUBLIC_RESOURCE_URL',
    'CASE_STUDY_URL',
    'CALENDAR_URL',
    'LINKEDIN_ENABLE_IMAGE_UPLOAD',
    'SOCIAL_CONTENT_DRY_RUN',
  ]) {
    delete process.env[key];
  }
  resetConfigCache();
}
