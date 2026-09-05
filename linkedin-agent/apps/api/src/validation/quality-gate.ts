import type { Signal, Strategy } from '../agents/linkedin-content-agent/strategy.js';
import type { AuthenticityIdea } from '../store/authenticity-pack.js';
import type { SwipeFileEntry } from '../store/swipe-file.js';
import {
  BANNED_PHRASES,
  CLICKBAIT_PATTERNS,
  UNSUPPORTED_AUTOMATION_PATTERNS,
} from './banned-phrases.js';
import type { ContentPackage, QualityResult } from './linkedin-content-schema.js';

/** Marker the research step writes when Tavily was unavailable. */
export const NO_RESEARCH_MARKER = 'Current research unavailable';

export interface QualityGateContext {
  strategy: Strategy;
  minWords: number;
  maxWords: number;
  /** Destination key -> configured URL. An empty URL means the CTA cannot be honoured. */
  destinations: Record<string, string>;
  swipeEntries?: SwipeFileEntry[];
  authenticityIdeas?: AuthenticityIdea[];
  /** Topics published or drafted inside the rolling window, for duplicate prevention. */
  recentTopics?: string[];
}

interface Check {
  id: string;
  weight: number;
  run: (content: ContentPackage, context: QualityGateContext) => string[];
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lines(post: string): string[] {
  return post
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

const MECHANISM_TERMS = [
  'retry',
  'retries',
  'idempot',
  'queue',
  'state',
  'route',
  'routing',
  'webhook',
  'timeout',
  'log',
  'audit',
  'validation',
  'validate',
  'monitor',
  'alert',
  'threshold',
  'fallback',
  'handoff',
  'schema',
  'rate limit',
  'checkpoint',
  'dead letter',
  'backoff',
  'escalat',
  'trigger',
  'pipeline',
  'orchestrat',
  'observab',
  'recover',
  'rollback',
  'sla',
  'latency',
  'concurrency',
  'dedup',
];

const ICP_SITUATION_TERMS = [
  'team',
  'teams',
  'founder',
  'founders',
  'operator',
  'operators',
  'ops',
  'business',
  'businesses',
  'company',
  'companies',
  'workflow',
  'workflows',
  'automation',
  'agent',
  'agents',
  'pipeline',
  'lead',
  'leads',
  'support',
  'revenue',
  'staff',
  'process',
  'system',
  'systems',
  'customer',
  'customers',
  'client',
  'clients',
  'b2b',
];

const GENERIC_HOOK_PATTERNS: RegExp[] = [
  /^ai is changing everything/i,
  /^here(?:'|’)?s what i learned/i,
  /^let(?:'|’)?s talk about/i,
  /^a quick thought/i,
  /^some thoughts on/i,
  /^the future of (?:ai|work) is/i,
];

const RECENCY_CLAIM_PATTERNS: RegExp[] = [
  /\btoday\b/i,
  /\byesterday\b/i,
  /\bthis (?:week|morning)\b/i,
  /\blast week\b/i,
  /\bjust (?:announced|launched|shipped|released)\b/i,
  /\bbreaking\b/i,
  /\bnewly (?:announced|released)\b/i,
  /\bthis (?:month|quarter)\b/i,
];

const TESTIMONIAL_PATTERN = /["“][^"”]{20,}["”]\s*[—–-]\s*[A-Z]/;
const CLIENT_CLAIM_PATTERNS: RegExp[] = [
  /\b(?:one of (?:my|our) clients|a client of (?:mine|ours))\b/i,
  // A named party, so "we helped teams" stays fine but "we helped Acme" does not.
  /\b(?:we helped|our client)\s+[A-Z][a-zA-Z]+/,
];
const MONEY_PATTERN = /(?:[$₹€£]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|million|billion)?)|\b\d[\d,]*\s?(?:usd|dollars)\b/i;
const PERCENT_PATTERN = /\b\d{1,3}(?:\.\d+)?\s?%/;
const HASHTAG_PATTERN = /(?:^|\s)#[A-Za-z][\w-]*/;
const TEMPLATE_VAR_PATTERN = /\{\{[^}]*\}\}/;
const EMOJI_PATTERN =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const CTA_FAMILIES: { id: string; pattern: RegExp }[] = [
  { id: 'follow', pattern: /\bfollow (?:me|along|for)\b/i },
  { id: 'save', pattern: /\bsave (?:this|it)\b|\buse this as a checklist\b/i },
  { id: 'repost', pattern: /\b(?:repost|share this)\b/i },
  { id: 'profile', pattern: /\b(?:in|on) my profile\b|\bprofile link\b/i },
  { id: 'link', pattern: /\blinked below\b|\blink in (?:the )?(?:first )?comment\b/i },
  { id: 'call', pattern: /\bbook a (?:call|slot|time)\b|\bmy calendar\b/i },
];

function matchesSignalLibrary(value: string, library: Signal[]): boolean {
  const normalized = normalize(value);
  if (normalized === '') return false;
  return library.some(
    (signal) =>
      normalize(signal.id) === normalized ||
      normalize(signal.text) === normalized ||
      normalized.includes(normalize(signal.text)) ||
      normalize(signal.text).includes(normalized),
  );
}

/**
 * Whether the package names a real ICP situation from the configured libraries.
 * Exported so the calendar and the agent can pre-check an idea before spending
 * a generation call.
 */
export function classifyIcpRelevance(
  content: Pick<ContentPackage, 'painSignal' | 'dreamSignal' | 'targetAudience' | 'linkedinPost'>,
  strategy: Strategy,
): { relevant: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const painOk = matchesSignalLibrary(content.painSignal, strategy.painSignals);
  const dreamOk = matchesSignalLibrary(content.dreamSignal, strategy.dreamSignals);
  if (!painOk && !dreamOk) {
    reasons.push(
      'No pain signal or dream signal from the configured libraries. Every post must name a real ICP situation.',
    );
  }
  const audience = normalize(content.targetAudience);
  if (audience.length < 8) {
    reasons.push('targetAudience is too vague to identify a buyer situation.');
  }
  const body = normalize(content.linkedinPost);
  if (!ICP_SITUATION_TERMS.some((term) => new RegExp(`\\b${term}\\b`).test(body))) {
    reasons.push('The post never names a buyer, team or business situation.');
  }
  return { relevant: reasons.length === 0, reasons };
}

/** Longest run of identical consecutive words shared between two texts. */
export function longestSharedNgram(a: string, b: string): number {
  const left = normalize(a).split(' ').filter(Boolean);
  const right = normalize(b).split(' ').filter(Boolean);
  if (left.length === 0 || right.length === 0) return 0;
  let best = 0;
  let previous = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
        if ((current[j] ?? 0) > best) best = current[j] ?? 0;
      }
    }
    previous = current;
  }
  return best;
}

/** Verbatim overlap of this many words with a swipe-file entry counts as copying. */
export const SWIPE_COPY_NGRAM_THRESHOLD = 8;

const CHECKS: Check[] = [
  {
    id: 'post-present',
    weight: 3,
    run: (content) => (content.linkedinPost.trim() === '' ? ['The LinkedIn post is empty.'] : []),
  },
  {
    id: 'word-count',
    weight: 2,
    run: (content, context) => {
      const words = countWords(content.linkedinPost);
      if (words < context.minWords) {
        return [`Post is ${words} words; the minimum is ${context.minWords}.`];
      }
      if (words > context.maxWords) {
        return [`Post is ${words} words; the maximum is ${context.maxWords}.`];
      }
      return [];
    },
  },
  {
    id: 'hook-length',
    weight: 2,
    run: (content) => {
      const words = countWords(content.linkedinHook);
      if (words === 0) return ['The hook is empty.'];
      if (words >= 12) return [`Hook is ${words} words; it must be fewer than 12.`];
      return [];
    },
  },
  {
    id: 'hook-not-a-question',
    weight: 1,
    run: (content) =>
      content.linkedinHook.trim().endsWith('?') ? ['The hook is a question; use a statement.'] : [],
  },
  {
    id: 'hook-specific',
    weight: 1,
    run: (content) => {
      const reasons: string[] = [];
      const hook = content.linkedinHook.trim();
      if (countWords(hook) < 4) reasons.push('The hook is too short to create tension or relevance.');
      if (GENERIC_HOOK_PATTERNS.some((pattern) => pattern.test(hook))) {
        reasons.push('The hook is a generic opener with no specific buyer or tension.');
      }
      if (CLICKBAIT_PATTERNS.some((pattern) => pattern.test(hook))) {
        reasons.push('The hook uses empty clickbait or an unsupported guarantee.');
      }
      return reasons;
    },
  },
  {
    id: 'hook-is-first-line',
    weight: 1,
    run: (content) => {
      const first = lines(content.linkedinPost)[0] ?? '';
      return normalize(first) === normalize(content.linkedinHook)
        ? []
        : ['The first line of the post is not the declared hook.'];
    },
  },
  {
    id: 'first-three-lines',
    weight: 2,
    run: (content) => {
      const opening = lines(content.linkedinPost).slice(0, 3).join(' ');
      const reasons: string[] = [];
      if (countWords(opening) < 12) {
        reasons.push('The first three lines are too thin to create curiosity and promise a payoff.');
      }
      const normalized = normalize(opening);
      if (!ICP_SITUATION_TERMS.some((term) => new RegExp(`\\b${term}\\b`).test(normalized))) {
        reasons.push('The first three lines do not identify a specific buyer or situation.');
      }
      return reasons;
    },
  },
  {
    id: 'concrete-mechanism',
    weight: 2,
    run: (content) => {
      const body = normalize(content.linkedinPost);
      const hits = new Set(MECHANISM_TERMS.filter((term) => body.includes(term)));
      if (hits.size >= 2) return [];
      if (hits.size === 1 && /\d/.test(content.linkedinPost)) return [];
      return [
        'The post has no concrete mechanism, framework or evidence — only commentary.',
      ];
    },
  },
  {
    id: 'banned-phrases',
    weight: 2,
    run: (content) => {
      const haystack = content.linkedinPost.toLowerCase();
      const found = BANNED_PHRASES.filter((phrase) => haystack.includes(phrase.toLowerCase()));
      return found.length > 0 ? [`Banned AI phrasing: ${[...new Set(found)].join(', ')}.`] : [];
    },
  },
  {
    id: 'no-hashtags',
    weight: 1,
    run: (content) =>
      HASHTAG_PATTERN.test(content.linkedinPost) ? ['The post contains hashtags.'] : [],
  },
  {
    id: 'no-emoji',
    weight: 1,
    run: (content) =>
      EMOJI_PATTERN.test(content.linkedinPost) ? ['The post contains emoji; the default voice uses none.'] : [],
  },
  {
    id: 'no-template-variables',
    weight: 2,
    run: (content) => {
      const fields: [string, string][] = [
        ['linkedinPost', content.linkedinPost],
        ['linkedinHook', content.linkedinHook],
        ['ctaText', content.ctaText],
        ['imagePrompt', content.imagePrompt],
      ];
      return fields
        .filter(([, value]) => TEMPLATE_VAR_PATTERN.test(value))
        .map(([field]) => `Unrendered template variable in ${field}.`);
    },
  },
  {
    id: 'no-unsupported-automation',
    weight: 3,
    run: (content) => {
      const haystack = `${content.linkedinPost}\n${content.ctaText}`;
      return UNSUPPORTED_AUTOMATION_PATTERNS.filter((rule) => rule.pattern.test(haystack)).map(
        (rule) =>
          `Unsupported automation promise (${rule.id}): the post ${rule.label}, but this system never comments, replies or sends DMs.`,
      );
    },
  },
  {
    id: 'icp-relevance',
    weight: 3,
    run: (content, context) => classifyIcpRelevance(content, context.strategy).reasons,
  },
  {
    id: 'point-of-view',
    weight: 2,
    run: (content, context) => {
      const declared = normalize(content.pointOfView);
      if (declared === '') return ['No point of view assigned to the post.'];
      const known = context.strategy.beliefs.some(
        (belief) =>
          normalize(belief.id) === declared ||
          normalize(belief.claim) === declared ||
          declared.includes(normalize(belief.id)) ||
          normalize(belief.claim).includes(declared) ||
          declared.includes(normalize(belief.claim)),
      );
      return known
        ? []
        : ['The declared point of view is not one of the configured category beliefs.'];
    },
  },
  {
    id: 'cta-supported',
    weight: 3,
    run: (content, context) => {
      const reasons: string[] = [];
      const definition = context.strategy.cta.ctaTypes[content.ctaType];
      if (!definition) {
        reasons.push(`Unknown CTA type "${content.ctaType}".`);
        return reasons;
      }
      const preferred = context.strategy.cta.preferredByPostType[content.postType] ?? [];
      if (!preferred.includes(content.ctaType)) {
        reasons.push(
          `CTA "${content.ctaType}" does not match post type "${content.postType}" (allowed: ${preferred.join(', ')}).`,
        );
      }
      if (definition.destination !== null) {
        const url = context.destinations[definition.destination] ?? '';
        if (url.trim() === '') {
          reasons.push(
            `CTA "${content.ctaType}" points at ${definition.destination}, which is not configured. Set it or choose a CTA that needs no link.`,
          );
        } else if (content.publicResourceUrl.trim() !== '' && content.publicResourceUrl.trim() !== url.trim()) {
          reasons.push('publicResourceUrl does not match the configured destination URL.');
        }
      } else if (content.publicResourceUrl.trim() !== '') {
        reasons.push(`CTA "${content.ctaType}" needs no URL but publicResourceUrl is set.`);
      }
      if (!normalize(content.linkedinPost).includes(normalize(content.ctaText))) {
        reasons.push('The declared CTA text does not appear in the post.');
      }
      return reasons;
    },
  },
  {
    id: 'single-cta',
    weight: 1,
    run: (content) => {
      const families = CTA_FAMILIES.filter((family) => family.pattern.test(content.linkedinPost));
      return families.length > 1
        ? [`The post has competing CTAs (${families.map((f) => f.id).join(', ')}); use exactly one.`]
        : [];
    },
  },
  {
    id: 'no-fabricated-proof',
    weight: 3,
    run: (content) => {
      const reasons: string[] = [];
      const post = content.linkedinPost;
      if (TESTIMONIAL_PATTERN.test(post)) {
        reasons.push('The post contains what reads as an attributed testimonial.');
      }
      if (CLIENT_CLAIM_PATTERNS.some((pattern) => pattern.test(post))) {
        reasons.push('The post references a named or implied client engagement.');
      }
      const cited =
        content.researchSource.trim() !== '' &&
        !content.researchSource.startsWith(NO_RESEARCH_MARKER);
      const hasAuthenticity = content.authenticitySource.trim() !== '';
      if (MONEY_PATTERN.test(post) && !cited && !hasAuthenticity) {
        reasons.push('The post states a money figure with no research citation or authenticity source.');
      }
      if (PERCENT_PATTERN.test(post) && !cited && !hasAuthenticity) {
        reasons.push('The post states a percentage with no research citation or authenticity source.');
      }
      return reasons;
    },
  },
  {
    id: 'research-honesty',
    weight: 2,
    run: (content) => {
      if (content.researchSource.trim() === '') return ['researchSource is empty.'];
      if (!content.researchSource.startsWith(NO_RESEARCH_MARKER)) return [];
      const offending = RECENCY_CLAIM_PATTERNS.filter((pattern) => pattern.test(content.linkedinPost));
      return offending.length > 0
        ? [
            'The post makes a recency claim, but current research was unavailable. An evergreen idea must not be framed as news.',
          ]
        : [];
    },
  },
  {
    id: 'authenticity-attribution',
    weight: 3,
    run: (content, context) => {
      if (content.postType !== 'Founder/Practitioner Story') {
        return content.authenticitySource.trim() !== '' &&
          (context.authenticityIdeas ?? []).length === 0
          ? ['authenticitySource is set but the authenticity pack is empty.']
          : [];
      }
      const source = content.authenticitySource.trim();
      if (source === '') {
        return [
          'A founder/practitioner story needs an authenticity-pack source. The system never invents lived experience.',
        ];
      }
      const ideas = context.authenticityIdeas ?? [];
      const matched = ideas.some(
        (idea) => idea.id === source || normalize(idea.rawText).includes(normalize(source)),
      );
      return matched
        ? []
        : [`authenticitySource "${source}" does not match any entry in the authenticity pack.`];
    },
  },
  {
    id: 'swipe-file-originality',
    weight: 3,
    run: (content, context) => {
      const entries = context.swipeEntries ?? [];
      const reasons: string[] = [];
      for (const entry of entries) {
        const candidates = [entry.hookPattern, entry.structure, entry.adaptationIdea];
        for (const candidate of candidates) {
          if (
            candidate.trim() !== '' &&
            longestSharedNgram(content.linkedinPost, candidate) >= SWIPE_COPY_NGRAM_THRESHOLD
          ) {
            reasons.push(
              `The post reproduces wording from swipe-file entry "${entry.id}". Study the pattern, do not copy the words.`,
            );
            break;
          }
        }
      }
      return reasons;
    },
  },
  {
    id: 'duplicate-topic',
    weight: 2,
    run: (content, context) => {
      const recent = context.recentTopics ?? [];
      const topic = normalize(content.topic);
      const clash = recent.find((previous) => {
        const normalizedPrevious = normalize(previous);
        if (normalizedPrevious === '') return false;
        return (
          normalizedPrevious === topic ||
          longestSharedNgram(topic, normalizedPrevious) >= 5
        );
      });
      return clash === undefined
        ? []
        : [`Topic repeats a recent post ("${clash}"). Vary the evidence and the angle.`];
    },
  },
  {
    id: 'image-prompt',
    weight: 1,
    run: (content) => {
      if (!content.needsImage) {
        return content.imagePrompt.trim() === ''
          ? []
          : ['imagePrompt is set but needsImage is false.'];
      }
      const prompt = content.imagePrompt.trim();
      const reasons: string[] = [];
      if (prompt === '') {
        reasons.push('needsImage is true but imagePrompt is empty.');
        return reasons;
      }
      if (/screenshot|stock photo|glossy|photorealistic|3d render/i.test(prompt)) {
        reasons.push('imagePrompt asks for a fake screenshot or stock-photo look.');
      }
      if (longestSharedNgram(prompt, content.linkedinPost) >= 10) {
        reasons.push('The image repeats the caption instead of adding value.');
      }
      return reasons;
    },
  },
];

const TOTAL_WEIGHT = CHECKS.reduce((sum, check) => sum + check.weight, 0);

/**
 * Runs every editorial rule against a parsed content package.
 * Never throws: a failing gate is a result, not an exception.
 */
export function runQualityGate(
  content: ContentPackage,
  context: QualityGateContext,
): QualityResult {
  const failReasons: string[] = [];
  let failedWeight = 0;
  let unsupportedAutomationDetected = false;

  for (const check of CHECKS) {
    const reasons = check.run(content, context);
    if (reasons.length > 0) {
      failedWeight += check.weight;
      failReasons.push(...reasons);
      if (check.id === 'no-unsupported-automation') unsupportedAutomationDetected = true;
    }
  }

  const qualityScore = Math.round(((TOTAL_WEIGHT - failedWeight) / TOTAL_WEIGHT) * 100);
  return {
    passed: failReasons.length === 0,
    failReasons,
    wordCount: countWords(content.linkedinPost),
    qualityScore,
    unsupportedAutomationDetected,
    content,
  };
}
