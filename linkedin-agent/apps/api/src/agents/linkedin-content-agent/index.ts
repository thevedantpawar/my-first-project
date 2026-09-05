import { destinationUrls, getConfig } from '../../config.js';
import { generateJson } from '../../providers/gemini.js';
import type { ResearchDigest } from '../../providers/tavily.js';
import { loadSwipeFile } from '../../store/swipe-file.js';
import { suggestAuthenticityIdeas } from '../../store/authenticity-pack.js';
import type { AuthenticityIdea } from '../../store/authenticity-pack.js';
import { parseContentPackage } from '../../validation/linkedin-content-schema.js';
import type { ContentPackage } from '../../validation/linkedin-content-schema.js';
import { AppError } from '../../lib/errors.js';
import { postTypeForDate } from '../../calendar/content-calendar.js';
import {
  CONTENT_RESPONSE_SCHEMA,
  buildSystemInstruction,
  buildUserPrompt,
} from './prompt.js';
import type { CtaType, PointOfViewBelief, PostType, Signal, Strategy } from './strategy.js';

export interface Assignment {
  postType: PostType;
  belief: PointOfViewBelief;
  painSignal: Signal;
  dreamSignal: Signal;
  ctaOptions: { ctaType: CtaType; url: string | null; examples: string[] }[];
  authenticityIdeas: AuthenticityIdea[];
}

function rotate<T>(items: T[], seed: number): T {
  const item = items[((seed % items.length) + items.length) % items.length];
  if (!item) throw new AppError('config_invalid', 'Strategy library is empty.');
  return item;
}

/**
 * Chooses the format, belief, signals and allowed CTAs for one run.
 *
 * `seed` is the number of runs so far, so consecutive runs rotate through the
 * libraries instead of settling on whatever the model likes most.
 */
export function planAssignment(
  strategy: Strategy,
  options: { date?: Date; seed?: number; postType?: PostType } = {},
): Assignment {
  const date = options.date ?? new Date();
  const seed = options.seed ?? 0;
  const scheduled = options.postType ?? postTypeForDate(strategy, date) ?? 'Named Problem';

  const authenticityIdeas = suggestAuthenticityIdeas(6);
  // Never assign a story format with no real material behind it.
  const postType: PostType =
    scheduled === 'Founder/Practitioner Story' && authenticityIdeas.length === 0
      ? 'Named Problem'
      : scheduled;

  const destinations = destinationUrls();
  const preferred = strategy.cta.preferredByPostType[postType] ?? ['follow'];
  const ctaOptions = preferred
    .map((ctaType) => {
      const definition = strategy.cta.ctaTypes[ctaType];
      if (!definition) return null;
      const url = definition.destination === null ? null : (destinations[definition.destination] ?? '');
      // Drop any CTA whose destination is not configured — the agent must not
      // be able to point at a resource that does not exist.
      if (definition.destination !== null && (url ?? '') === '') return null;
      return { ctaType, url: url === '' ? null : url, examples: definition.examples };
    })
    .filter((option): option is { ctaType: CtaType; url: string | null; examples: string[] } =>
      option !== null,
    );

  if (ctaOptions.length === 0) {
    const fallback = strategy.cta.ctaTypes.follow;
    if (fallback) ctaOptions.push({ ctaType: 'follow', url: null, examples: fallback.examples });
  }

  return {
    postType,
    belief: rotate(strategy.beliefs, seed),
    painSignal: rotate(strategy.painSignals, seed),
    dreamSignal: rotate(strategy.dreamSignals, seed),
    ctaOptions,
    authenticityIdeas: postType === 'Founder/Practitioner Story' ? authenticityIdeas : [],
  };
}

export interface GenerateOptions {
  strategy: Strategy;
  research: ResearchDigest;
  assignment: Assignment;
  recentTopics: string[];
  fetchImpl?: typeof fetch;
}

export interface GenerationOutcome {
  content: ContentPackage;
  prompt: { system: string; user: string };
}

/**
 * Calls Gemini once and parses the result. Shape failures raise
 * `gemini_invalid_output` with the field-level reasons attached.
 */
export async function generateContentPackage(
  options: GenerateOptions,
): Promise<GenerationOutcome> {
  const config = getConfig();
  const swipePatterns = loadSwipeFile().map((entry) => ({
    hookPattern: entry.hookPattern,
    structure: entry.structure,
    whyItWorks: entry.whyItWorks,
  }));

  const system = buildSystemInstruction(options.strategy);
  const user = buildUserPrompt({
    strategy: options.strategy,
    postType: options.assignment.postType,
    belief: options.assignment.belief,
    painSignal: options.assignment.painSignal,
    dreamSignal: options.assignment.dreamSignal,
    ctaOptions: options.assignment.ctaOptions,
    research: options.research,
    authenticityIdeas: options.assignment.authenticityIdeas,
    minWords: config.CONTENT_MIN_WORDS,
    maxWords: config.CONTENT_MAX_WORDS,
    recentTopics: options.recentTopics,
    swipePatterns,
  });

  const raw = await generateJson({
    systemInstruction: system,
    prompt: user,
    responseSchema: CONTENT_RESPONSE_SCHEMA,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const parsed = parseContentPackage(raw);
  if (!parsed.ok) {
    throw new AppError(
      'gemini_invalid_output',
      'Gemini returned a content package that does not match the contract.',
      { details: parsed.reasons.join(' ') },
    );
  }

  return { content: parsed.content, prompt: { system, user } };
}
