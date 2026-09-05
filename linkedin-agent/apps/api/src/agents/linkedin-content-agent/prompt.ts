import { CTA_TYPES, POST_TYPES } from './strategy.js';
import type { CtaType, PointOfViewBelief, PostType, Signal, Strategy } from './strategy.js';
import type { AuthenticityIdea } from '../../store/authenticity-pack.js';
import type { ResearchDigest } from '../../providers/tavily.js';
import { BANNED_PHRASES } from '../../validation/banned-phrases.js';
import { NO_RESEARCH_MARKER } from '../../validation/quality-gate.js';

/** Gemini responseSchema mirroring the content package contract. */
export const CONTENT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    postType: { type: 'string', enum: [...POST_TYPES] },
    topic: { type: 'string' },
    targetAudience: { type: 'string' },
    painSignal: { type: 'string' },
    dreamSignal: { type: 'string' },
    pointOfView: { type: 'string' },
    researchSource: { type: 'string' },
    linkedinHook: { type: 'string' },
    linkedinPost: { type: 'string' },
    ctaType: { type: 'string', enum: [...CTA_TYPES] },
    ctaText: { type: 'string' },
    publicResourceUrl: { type: 'string' },
    needsImage: { type: 'boolean' },
    imagePrompt: { type: 'string' },
    authenticitySource: { type: 'string' },
  },
  required: [
    'postType',
    'topic',
    'targetAudience',
    'painSignal',
    'dreamSignal',
    'pointOfView',
    'researchSource',
    'linkedinHook',
    'linkedinPost',
    'ctaType',
    'ctaText',
    'publicResourceUrl',
    'needsImage',
    'imagePrompt',
    'authenticitySource',
  ],
};

const FORMAT_BRIEFS: Record<PostType, string> = {
  'Named Problem': [
    '1. State a costly, specific problem.',
    '2. Show who experiences it.',
    '3. Explain the mechanism causing it.',
    '4. Show the operational or financial consequence, with no invented numbers.',
    '5. Give the practical fix or decision rule.',
    '6. End with one truthful CTA.',
  ].join('\n'),
  'Surfaced Problem/Audit': [
    '1. Describe a situation the buyer recognises.',
    '2. Give 3-7 diagnostic checks.',
    '3. Explain what each result means.',
    '4. Give one immediate fix.',
    '5. Say when expert implementation is justified.',
    '6. End with a save, share or follow CTA.',
  ].join('\n'),
  'Deep Work System': [
    '1. State the desired outcome.',
    '2. Show the system components.',
    '3. Explain routing, state, retries, validation and monitoring.',
    '4. Show the failure path, not only the happy path.',
    '5. Give a practical implementation sequence.',
  ].join('\n'),
  'Founder/Practitioner Story': [
    '1. Use a real event from the authenticity pack below. If none is supplied, do not write this format.',
    '2. Start with a concrete moment or decision.',
    '3. Explain what was believed before.',
    '4. Show what changed.',
    '5. Extract a lesson relevant to the ICP.',
    '6. No inspirational filler.',
  ].join('\n'),
  'Point-of-View': [
    '1. Make one clear claim.',
    '2. Name the common opposing belief.',
    '3. Explain why it fails in the target context.',
    '4. Give evidence or a concrete mechanism.',
    '5. State what Microns does differently.',
  ].join('\n'),
  'Lead Magnet': [
    '1. Describe the resource and exactly who it helps.',
    '2. Give away the most useful part in the post itself.',
    '3. Point at the configured public URL only. Never promise to send anything.',
  ].join('\n'),
  'Profile View Outreach': [
    '1. Name the buyer situation that brought them to the profile.',
    '2. Show one concrete mechanism they can use immediately.',
    '3. Point at the profile as the next step.',
  ].join('\n'),
};

export interface PromptInputs {
  strategy: Strategy;
  postType: PostType;
  belief: PointOfViewBelief;
  painSignal: Signal;
  dreamSignal: Signal;
  ctaOptions: { ctaType: CtaType; url: string | null; examples: string[] }[];
  research: ResearchDigest;
  authenticityIdeas: AuthenticityIdea[];
  minWords: number;
  maxWords: number;
  recentTopics: string[];
  swipePatterns: { hookPattern: string; structure: string; whyItWorks: string }[];
}

export function buildSystemInstruction(strategy: Strategy): string {
  const { positioning } = strategy.audience;
  return [
    `You write LinkedIn posts for ${positioning.operator}, who runs ${positioning.company}.`,
    `${positioning.company}: ${positioning.summary}`,
    `Focus areas: ${positioning.focus.join(', ')}.`,
    '',
    'Voice: an experienced practitioner typing between client calls. Plain language.',
    'Concrete mechanisms. Varied sentence length. Short paragraphs. The occasional',
    'sentence that begins with "And" or "But". No corporate filler.',
    '',
    'Hard rules you must never break:',
    '- No hashtags. No emoji.',
    '- No fake client names, invented testimonials, or unsupported revenue or percentage claims.',
    '- Never promise a DM, an automatic reply, a comment mention, or keyword delivery.',
    '  This system has no comment automation and no messaging. A CTA that needs one is a lie.',
    '- Never invent lived experience. Personal stories come only from the supplied authenticity pack.',
    '- Never present an evergreen idea as breaking news.',
    `- Never use these phrases: ${BANNED_PHRASES.join(' / ')}.`,
    '',
    'Return one JSON object matching the supplied schema. No prose outside the JSON.',
  ].join('\n');
}

export function buildUserPrompt(inputs: PromptInputs): string {
  const {
    strategy,
    postType,
    belief,
    painSignal,
    dreamSignal,
    ctaOptions,
    research,
    authenticityIdeas,
    minWords,
    maxWords,
    recentTopics,
    swipePatterns,
  } = inputs;

  const sections: string[] = [];

  sections.push(
    ['# Assignment', `Write exactly one LinkedIn post in the "${postType}" format.`].join('\n'),
  );

  sections.push(['# Format brief', FORMAT_BRIEFS[postType]].join('\n'));

  sections.push(
    [
      '# Audience',
      ...strategy.audience.primaryAudience.map((line) => `- ${line}`),
      '',
      'Do not write for generic technology audiences or for other agencies.',
      'Reject these angles outright:',
      ...strategy.audience.rejectTopics.map((line) => `- ${line}`),
    ].join('\n'),
  );

  sections.push(
    [
      '# Point of view to reinforce',
      `Belief: ${belief.claim}`,
      `Common opposing belief: ${belief.opposingBelief}`,
      `Evidence angles you may use: ${belief.evidenceAngles.join('; ')}`,
      '',
      `Set "pointOfView" to exactly: ${belief.id}`,
      'Reuse the belief, but vary the evidence, story, mechanism and format. Do not repeat it as a slogan.',
    ].join('\n'),
  );

  sections.push(
    [
      '# Buyer signals',
      `Pain signal (use this one): ${painSignal.text} — situation: ${painSignal.buyerSituation}`,
      `Dream signal available: ${dreamSignal.text} — situation: ${dreamSignal.buyerSituation}`,
      '',
      `Set "painSignal" to exactly: ${painSignal.text}`,
      `Set "dreamSignal" to exactly: ${dreamSignal.text} (or "" if the post does not use it).`,
      'Name the intended buyer situation inside the post.',
    ].join('\n'),
  );

  if (research.available) {
    sections.push(
      [
        '# Current research (Tavily)',
        'Use only what is here. Do not add companies, dates, numbers or sources that are absent.',
        research.digest,
        '',
        'Set "researchSource" to a one-line note naming the source you actually used, with its date if one is given.',
      ].join('\n'),
    );
  } else {
    sections.push(
      [
        '# Current research',
        `Unavailable: ${research.unavailableReason ?? 'no reason recorded'}.`,
        'Write an evergreen idea instead. Do not reference news, recent announcements, or anything',
        'that happened "this week" or "today".',
        `Set "researchSource" to start with exactly: ${NO_RESEARCH_MARKER}`,
      ].join('\n'),
    );
  }

  if (postType === 'Founder/Practitioner Story') {
    if (authenticityIdeas.length === 0) {
      sections.push(
        [
          '# Authenticity pack',
          'EMPTY. You cannot write a founder story without real material.',
          'Return the closest "Named Problem" post instead and leave "authenticitySource" empty.',
        ].join('\n'),
      );
    } else {
      sections.push(
        [
          '# Authenticity pack (the founder\'s own words)',
          'Build the story from exactly one of these. Structure and tighten it; do not invent',
          'events, people or outcomes that are not here.',
          ...authenticityIdeas.map((idea) => `- [${idea.id}] (${idea.sourceKind}) ${idea.rawText}`),
          '',
          'Set "authenticitySource" to the bracketed id of the entry you used.',
        ].join('\n'),
      );
    }
  } else {
    sections.push('# Authenticity\nLeave "authenticitySource" empty. Do not write a personal anecdote.');
  }

  sections.push(
    [
      '# CTA',
      'Exactly one CTA, as the last line of the post. Set "ctaText" to that line verbatim.',
      'Choose one of these ctaType values — no others are configured:',
      ...ctaOptions.map(
        (option) =>
          `- ${option.ctaType}${option.url ? ` (points at ${option.url})` : ' (no link needed)'}: e.g. "${option.examples[0]}"`,
      ),
      '',
      'Set "publicResourceUrl" to the exact configured URL when the CTA points at one, otherwise "".',
      'Never write "comment", "DM", "reply with", or any promise to send something.',
    ].join('\n'),
  );

  sections.push(
    [
      '# Caption rules',
      `- ${minWords}-${maxWords} words. Count them.`,
      '- The first line is the hook. Fewer than 12 words. A statement, not a question.',
      '- The first three lines must create tension, name a specific buyer or situation, and promise a concrete payoff.',
      '- Short paragraphs, one to three sentences, one idea each.',
      '- Explain one specific failure mode, workflow, mechanism or framework.',
      '- Bullets only when they genuinely help scanning.',
      '',
      'Write "linkedinPost" first. Then copy its literal first line into',
      '"linkedinHook", character for character — same words, same punctuation, no',
      'rewording and no added preamble. A mismatch is rejected automatically.',
    ].join('\n'),
  );

  sections.push(
    [
      '# Image',
      'Set "needsImage" true only when a diagram would materially improve comprehension.',
      'When true, "imagePrompt" must describe a literal diagram, flowchart, whiteboard sketch',
      'or before/after visual: minimal flat illustration, clean background, one dominant idea,',
      'a legible headline and no dense text.',
      '',
      'These words are rejected automatically and must not appear anywhere in',
      '"imagePrompt": screenshot, stock photo, glossy, photorealistic, 3d render.',
      'Describe the drawing itself — boxes, arrows, labels, panels — not a photograph',
      'or a picture of a product.',
      '',
      'The visual must complement the caption, not restate it: it must not reuse a',
      'run of ten or more words from the post.',
      'When false, "imagePrompt" must be "".',
    ].join('\n'),
  );

  if (recentTopics.length > 0) {
    sections.push(
      [
        '# Already covered recently — pick a different angle',
        ...recentTopics.slice(-12).map((topic) => `- ${topic}`),
      ].join('\n'),
    );
  }

  if (swipePatterns.length > 0) {
    sections.push(
      [
        '# Structural patterns worth studying (patterns only)',
        'These describe how other posts are built. Never reuse their wording.',
        ...swipePatterns
          .slice(0, 8)
          .map((entry) => `- hook pattern: ${entry.hookPattern} | structure: ${entry.structure} | why: ${entry.whyItWorks}`),
      ].join('\n'),
    );
  }

  sections.push(
    [
      '# Output',
      'Return the JSON object only. "topic" must be a specific narrow topic, not a category.',
      '"targetAudience" must name the buyer situation in one line.',
    ].join('\n'),
  );

  return sections.join('\n\n');
}
