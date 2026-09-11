/**
 * Phrasing that marks a draft as AI residue rather than a practitioner's voice.
 *
 * Hard bans only: a phrase here is blocked on a single occurrence, so the list
 * stays to constructions that have no innocent use. Softer single-word markers
 * are scored by density in AI_MARKERS instead — see the cluster principle
 * below.
 */
export const BANNED_PHRASES: readonly string[] = [
  'in today’s fast-paced world',
  "in today's fast-paced world",
  'unlock the power',
  'game-changer',
  'game changer',
  'delve into',
  'it is important to note',
  'elevate your',
  'leverage the power',
  'supercharge',
  'in conclusion',
  'thoughts?',
  // Ported from sergebulaev/linkedin-skills (MIT) — voice-rules.md.
  'at the end of the day',
  'deep dive',
  'tapestry',
  'in the realm of',
  'a paradigm shift',
  'needle-moving',
  'best-in-class',
  'move the needle on',
];

/**
 * Single-word AI markers, scored by density rather than banned outright.
 *
 * The cluster principle, from the same source: readers spot AI text from
 * clusters, not single words. One "robust" is English; "robust", "seamless" and
 * "leverage" in one post is a signature. Banning these individually would
 * reject honest writing, so the gate only objects once several appear together.
 */
export const AI_MARKERS: readonly string[] = [
  'leverage',
  'utilize',
  'facilitate',
  'streamline',
  'robust',
  'seamless',
  'navigate',
  'harness',
  'foster',
  'cultivate',
  'fundamentally',
  'essentially',
  'ultimately',
  'crucially',
  'notably',
  'landscape',
  'ecosystem',
  'paradigm',
  'realm',
  'journey',
  'comprehensive',
  'pivotal',
  'myriad',
  'testament',
  'underscore',
  'empower',
];

/** Above this many distinct markers, the post reads as machine-written. */
export const AI_MARKER_DENSITY_LIMIT = 3;

/**
 * "It's not just X, it's Y" and friends. Negative parallelism is the single
 * most reliable tell in 2026 and is always scrubbed, at any density.
 */
export const NEGATIVE_PARALLELISM_PATTERNS: readonly RegExp[] = [
  /\bit(?:'|’)?s not (?:just|only|about) [^.!?\n]{2,60}(?:,| —|--) it(?:'|’)?s\b/i,
  /\bthis is(?:n(?:'|’)?t| not) (?:just|only|about) [^.!?\n]{2,60}(?:,| —|--) it(?:'|’)?s\b/i,
  /\bnot (?:just|merely|simply) [^.!?\n]{2,60}(?:,| but| —)(?: also)? [^.!?\n]{2,60}\b/i,
];

/** Em dashes per 100 words. The character is fine; the density is the tell. */
export const EM_DASH_PER_100_WORDS = 1.5;

/**
 * Promises the system cannot keep. This build has no comment monitoring, no
 * automatic replies, no commenter mentions and no DMs, so a post must never
 * offer them.
 */
export const UNSUPPORTED_AUTOMATION_PATTERNS: readonly { id: string; pattern: RegExp; label: string }[] = [
  {
    id: 'keyword-comment',
    pattern: /\bcomment\s+(?:the\s+word\s+)?["'“]?[A-Z][A-Z0-9]{2,}["'”]?/,
    label: 'asks for a keyword comment',
  },
  {
    id: 'comment-to-receive',
    pattern: /\bcomment\b[^.!?\n]{0,60}\b(?:and|to)\b[^.!?\n]{0,60}\b(?:i(?:'|’)?ll|i will|receive|get|send)\b/i,
    label: 'promises delivery in exchange for a comment',
  },
  {
    id: 'dm-me',
    pattern: /\b(?:dm|pm)\s+me\b|\bsend\s+me\s+a\s+(?:dm|pm|message)\b|\bdrop\s+me\s+a\s+(?:dm|pm|message)\b/i,
    label: 'asks for a DM',
  },
  {
    id: 'reply-with-keyword',
    pattern: /\breply\s+(?:with|to\s+this\s+with)\b/i,
    label: 'asks for a keyword reply',
  },
  {
    id: 'i-will-message',
    pattern: /\bi(?:'|’)?(?:ll|\s+will)\s+(?:message|dm|pm|email)\b/i,
    label: 'promises to message people',
  },
  {
    id: 'i-will-send',
    pattern: /\bi(?:'|’)?(?:ll|\s+will)\s+send\s+(?:you|it|everyone|them|the|over)\b/i,
    label: 'promises to send a file',
  },
  {
    id: 'auto-send',
    pattern: /\bautomatically\s+send\b|\bauto[-\s]?(?:dm|reply|respond)\b/i,
    label: 'promises automated delivery',
  },
  {
    id: 'tag-and-receive',
    pattern: /\btag\s+(?:a\s+friend|someone)\b[^.!?\n]{0,40}\b(?:and|to)\b[^.!?\n]{0,40}\b(?:receive|get|send)\b/i,
    label: 'promises delivery in exchange for a tag',
  },
];

/** Hooks that promise more than the post delivers. */
export const CLICKBAIT_PATTERNS: readonly RegExp[] = [
  /you won(?:'|’)?t believe/i,
  /this one weird trick/i,
  /\bshocking\b/i,
  /\bguaranteed\b/i,
  /\bi promise you\b/i,
];
