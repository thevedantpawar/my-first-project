/** Phrasing that marks a draft as AI residue rather than a practitioner's voice. */
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
];

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
