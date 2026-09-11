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
  buildRevisionPrompt,
  buildSystemInstruction,
  buildUserPrompt,
} from './prompt.js';
import type {
  CtaType,
  HookFormula,
  PointOfViewBelief,
  PostType,
  Signal,
  Strategy,
} from './strategy.js';

export interface Assignment {
  postType: PostType;
  belief: PointOfViewBelief;
  painSignal: Signal;
  dreamSignal: Signal;
  ctaOptions: { ctaType: CtaType; url: string | null; examples: string[] }[];
  authenticityIdeas: AuthenticityIdea[];
  /** The hook formula this post should be built on. */
  formula: HookFormula;
  /** Set when the scheduled format could not be used, and why. */
  substitution: { from: PostType; reason: string } | null;
}

/**
 * Formulas this run can actually deliver.
 *
 * A formula that needs lived experience is only offered when the authenticity
 * pack has material, and one that needs a real figure only when research
 * supplied a citable source — otherwise the model is being invited to invent,
 * and the gate would block the result anyway.
 */
export function usableFormulas(
  strategy: Strategy,
  postType: PostType,
  options: { hasAuthenticity: boolean; hasCitedResearch: boolean },
): HookFormula[] {
  const fits = strategy.hookFormulas.filter(
    (formula) => formula.postTypes.length === 0 || formula.postTypes.includes(postType),
  );
  const deliverable = (list: HookFormula[]): HookFormula[] =>
    list.filter(
      (formula) =>
        (!formula.requiresAuthenticity || options.hasAuthenticity) &&
        (!formula.requiresCitedNumbers || options.hasCitedResearch),
    );

  // Widen rather than return nothing. Every formula mapped to the founder-story
  // format needs lived experience, so with an empty pack the preferred set is
  // legitimately empty — and handing the caller [] made it fall through to an
  // unrelated formula. Prefer fit, then deliverability, then anything safe.
  const preferred = deliverable(fits);
  if (preferred.length > 0) return preferred;

  const anyDeliverable = deliverable(strategy.hookFormulas);
  if (anyDeliverable.length > 0) return anyDeliverable;

  return strategy.hookFormulas.filter(
    (formula) => !formula.requiresAuthenticity && !formula.requiresCitedNumbers,
  );
}

function rotate<T>(items: T[], seed: number): T {
  const item = items[((seed % items.length) + items.length) % items.length];
  if (!item) throw new AppError('config_invalid', 'Strategy library is empty.');
  return item;
}

type CtaOption = { ctaType: CtaType; url: string | null; examples: string[] };

/**
 * The CTAs a post type may actually use right now. A CTA whose destination URL
 * is not configured is dropped here rather than offered to the model — the
 * agent must never point at a resource that does not exist.
 */
function usableCtaOptions(
  strategy: Strategy,
  postType: PostType,
  destinations: Record<string, string>,
): CtaOption[] {
  const preferred = strategy.cta.preferredByPostType[postType] ?? [];
  return preferred
    .map((ctaType): CtaOption | null => {
      const definition = strategy.cta.ctaTypes[ctaType];
      if (!definition) return null;
      if (definition.destination === null) {
        return { ctaType, url: null, examples: definition.examples };
      }
      const url = (destinations[definition.destination] ?? '').trim();
      if (url === '') return null;
      return { ctaType, url, examples: definition.examples };
    })
    .filter((option): option is CtaOption => option !== null);
}

/** Order tried when the scheduled format cannot be produced honestly. */
const SUBSTITUTION_ORDER: PostType[] = [
  'Named Problem',
  'Surfaced Problem/Audit',
  'Deep Work System',
  'Point-of-View',
];

/**
 * Chooses the format, belief, signals and allowed CTAs for one run.
 *
 * `seed` is the number of runs so far, so consecutive runs rotate through the
 * libraries instead of settling on whatever the model likes most.
 *
 * A format the system cannot deliver honestly is swapped out here rather than
 * sent to the model and blocked afterwards: a founder story with no
 * authenticity pack, or a lead magnet with no configured destination URL, would
 * otherwise burn a generation call and produce nothing.
 */
export function planAssignment(
  strategy: Strategy,
  options: {
    date?: Date;
    seed?: number;
    postType?: PostType;
    hasCitedResearch?: boolean;
  } = {},
): Assignment {
  const date = options.date ?? new Date();
  const seed = options.seed ?? 0;
  const scheduled = options.postType ?? postTypeForDate(strategy, date) ?? 'Named Problem';
  const destinations = destinationUrls();
  const authenticityIdeas = suggestAuthenticityIdeas(6);

  let postType = scheduled;
  let substitution: { from: PostType; reason: string } | null = null;

  const substitute = (reason: string): void => {
    for (const candidate of SUBSTITUTION_ORDER) {
      if (candidate === postType) continue;
      if (usableCtaOptions(strategy, candidate, destinations).length === 0) continue;
      substitution = { from: scheduled, reason };
      postType = candidate;
      return;
    }
  };

  // Never assign a story format with no real material behind it.
  if (postType === 'Founder/Practitioner Story' && authenticityIdeas.length === 0) {
    substitute(
      'The authenticity pack is empty, and the system never invents lived experience. Add real material to use this format.',
    );
  }

  if (usableCtaOptions(strategy, postType, destinations).length === 0) {
    const needed = (strategy.cta.preferredByPostType[postType] ?? [])
      .map((ctaType) => strategy.cta.ctaTypes[ctaType]?.destination)
      .filter((destination): destination is string => Boolean(destination));
    substitute(
      `No CTA is available for this format: it needs one of ${needed.join(', ') || 'a configured destination'}, and none is set.`,
    );
  }

  const ctaOptions = usableCtaOptions(strategy, postType, destinations);
  if (ctaOptions.length === 0) {
    throw new AppError(
      'config_invalid',
      'No post format has a usable CTA. Configure at least one of PROFILE_URL, PUBLIC_RESOURCE_URL, CASE_STUDY_URL or CALENDAR_URL, or add a link-free CTA to config/strategy/cta.json.',
    );
  }

  const candidates = usableFormulas(strategy, postType, {
    hasAuthenticity: authenticityIdeas.length > 0,
    hasCitedResearch: options.hasCitedResearch ?? false,
  });
  const formula = candidates.length > 0 ? rotate(candidates, seed) : strategy.hookFormulas[0]!;

  return {
    postType,
    formula,
    belief: rotate(strategy.beliefs, seed),
    painSignal: rotate(strategy.painSignals, seed),
    dreamSignal: rotate(strategy.dreamSignals, seed),
    ctaOptions,
    authenticityIdeas: postType === 'Founder/Practitioner Story' ? authenticityIdeas : [],
    substitution,
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
    formula: options.assignment.formula,
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

/**
 * One corrective attempt after the quality gate rejected a draft.
 *
 * Costs a single extra Gemini call, only on the days that would otherwise
 * publish nothing. The gate still decides; this just stops a fixable slip —
 * a hook paraphrased out of sync, a forbidden word in an image prompt — from
 * costing the whole day's post.
 */
export async function reviseContentPackage(options: {
  previous: ContentPackage;
  failReasons: string[];
  prompt: { system: string; user: string };
  fetchImpl?: typeof fetch;
}): Promise<GenerationOutcome> {
  const user = buildRevisionPrompt(
    JSON.stringify(options.previous, null, 2),
    options.failReasons,
    options.prompt.user,
  );

  const raw = await generateJson({
    systemInstruction: options.prompt.system,
    prompt: user,
    responseSchema: CONTENT_RESPONSE_SCHEMA,
    // Lower temperature: this is a correction, not a fresh idea.
    temperature: 0.4,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const parsed = parseContentPackage(raw);
  if (!parsed.ok) {
    throw new AppError(
      'gemini_invalid_output',
      'The revised content package does not match the contract.',
      { details: parsed.reasons.join(' ') },
    );
  }
  return { content: parsed.content, prompt: { system: options.prompt.system, user } };
}
