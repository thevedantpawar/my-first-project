import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStrategy } from '../src/agents/linkedin-content-agent/strategy.js';
import type { Strategy } from '../src/agents/linkedin-content-agent/strategy.js';
import {
  NO_RESEARCH_MARKER,
  classifyIcpRelevance,
  countWords,
  longestSharedNgram,
  runQualityGate,
} from '../src/validation/quality-gate.js';
import type { QualityGateContext } from '../src/validation/quality-gate.js';
import { clearProviderEnv, makeContent, makePost, useTemporaryDataDir, VALID_CTA } from './fixtures.js';

let strategy: Strategy;
let temp: { dir: string; cleanup: () => void };

function context(overrides: Partial<QualityGateContext> = {}): QualityGateContext {
  return {
    strategy,
    minWords: 150,
    maxWords: 220,
    destinations: {
      PROFILE_URL: '',
      PUBLIC_RESOURCE_URL: '',
      CASE_STUDY_URL: '',
      CALENDAR_URL: '',
    },
    swipeEntries: [],
    authenticityIdeas: [],
    recentTopics: [],
    ...overrides,
  };
}

beforeAll(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  strategy = loadStrategy();
});

afterAll(() => temp.cleanup());

describe('word-count boundaries', () => {
  it('accepts a post at the 150-word lower boundary', () => {
    const content = makeContent({ linkedinPost: makePost(150) });
    const result = runQualityGate(content, context());
    expect(result.wordCount).toBe(150);
    expect(result.failReasons).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects a post one word below the lower boundary', () => {
    const result = runQualityGate(makeContent({ linkedinPost: makePost(149) }), context());
    expect(result.passed).toBe(false);
    expect(result.failReasons.join(' ')).toContain('149 words');
  });

  it('accepts a post at the 220-word upper boundary', () => {
    const result = runQualityGate(makeContent({ linkedinPost: makePost(220) }), context());
    expect(result.wordCount).toBe(220);
    expect(result.passed).toBe(true);
  });

  it('rejects a post one word above the upper boundary', () => {
    const result = runQualityGate(makeContent({ linkedinPost: makePost(221) }), context());
    expect(result.passed).toBe(false);
    expect(result.failReasons.join(' ')).toContain('221 words');
  });
});

describe('hook rules', () => {
  const elevenWordHook = 'Your lead routing workflow drops one message every single busy morning';
  const twelveWordHook = 'Your lead routing workflow quietly drops one message every single busy morning';

  it('accepts an 11-word hook', () => {
    expect(countWords(elevenWordHook)).toBe(11);
    const content = makeContent({
      linkedinHook: elevenWordHook,
      linkedinPost: makePost(180, { hook: elevenWordHook }),
    });
    expect(runQualityGate(content, context()).failReasons).toEqual([]);
  });

  it('rejects a 12-word hook', () => {
    expect(countWords(twelveWordHook)).toBe(12);
    const content = makeContent({
      linkedinHook: twelveWordHook,
      linkedinPost: makePost(180, { hook: twelveWordHook }),
    });
    const result = runQualityGate(content, context());
    expect(result.passed).toBe(false);
    expect(result.failReasons.join(' ')).toContain('12 words; it must be fewer than 12');
  });

  it('rejects a question as the hook', () => {
    const hook = 'Is your automation dropping work every week?';
    const content = makeContent({
      linkedinHook: hook,
      linkedinPost: makePost(180, { hook }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('question');
  });

  it('rejects a generic hook with no buyer or tension', () => {
    const hook = 'AI is changing everything for everyone';
    const content = makeContent({
      linkedinHook: hook,
      linkedinPost: makePost(180, { hook }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('generic opener');
  });

  it('rejects a post whose first line is not the declared hook', () => {
    const content = makeContent({ linkedinHook: 'A different opening line entirely' });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'first line of the post is not the declared hook',
    );
  });

  it('rejects first three lines that name no buyer or situation', () => {
    const hook = 'Nothing here matters much at all';
    const post = [hook, '', 'Everything else is fine.', '', 'It goes on like that.'].join('\n');
    const content = makeContent({ linkedinHook: hook, linkedinPost: post });
    const reasons = runQualityGate(content, context()).failReasons.join(' ');
    expect(reasons).toContain('first three lines do not identify a specific buyer');
  });
});

describe('banned phrasing, hashtags and template variables', () => {
  it('detects banned AI phrasing', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'In conclusion, this is the part that matters.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('Banned AI phrasing');
  });

  it('detects hashtags', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'A note on tooling #automation for the team.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('hashtags');
  });

  it('detects unrendered template variables', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'Consider {{company_name}} before you decide.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'Unrendered template variable',
    );
  });

  it('detects emoji', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'This is the part teams miss 🚀 every time.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('emoji');
  });
});

describe('unsupported automation CTAs', () => {
  const cases: [string, string][] = [
    ['keyword comment', "Comment WORKFLOW and I'll send you the blueprint."],
    ['DM request', 'DM me for the blueprint.'],
    ['keyword reply', 'Reply with GUIDE and it is yours.'],
    ['promise to message', "I'll message everyone who comments."],
    ['comment to receive', 'Comment below to receive the file.'],
    ['auto delivery', "I'll automatically send you the framework."],
  ];

  for (const [label, cta] of cases) {
    it(`blocks a CTA that ${label}`, () => {
      const content = makeContent({
        ctaText: cta,
        linkedinPost: makePost(180, { cta }),
      });
      const result = runQualityGate(content, context());
      expect(result.passed).toBe(false);
      expect(result.unsupportedAutomationDetected).toBe(true);
      expect(result.failReasons.join(' ')).toContain('never comments, replies or sends DMs');
    });
  }

  it('accepts a truthful low-friction CTA', () => {
    const result = runQualityGate(makeContent(), context());
    expect(result.unsupportedAutomationDetected).toBe(false);
    expect(result.passed).toBe(true);
  });
});

describe('CTA matching and configured destinations', () => {
  it('blocks a resource CTA when the destination URL is not configured', () => {
    const cta = 'The public implementation guide is linked in my profile.';
    const content = makeContent({
      postType: 'Deep Work System',
      ctaType: 'resource',
      ctaText: cta,
      linkedinPost: makePost(180, { cta }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'PUBLIC_RESOURCE_URL, which is not configured',
    );
  });

  it('accepts a resource CTA once the destination URL exists', () => {
    const cta = 'The public implementation guide is linked in my profile.';
    const content = makeContent({
      postType: 'Deep Work System',
      ctaType: 'resource',
      ctaText: cta,
      publicResourceUrl: 'https://microns.example/guide',
      linkedinPost: makePost(180, { cta }),
    });
    const result = runQualityGate(
      content,
      context({
        destinations: {
          PROFILE_URL: '',
          PUBLIC_RESOURCE_URL: 'https://microns.example/guide',
          CASE_STUDY_URL: '',
          CALENDAR_URL: '',
        },
      }),
    );
    expect(result.failReasons).toEqual([]);
  });

  it('blocks a CTA type that does not match the post type', () => {
    const cta = 'Follow for practical automation breakdowns.';
    const content = makeContent({
      postType: 'Surfaced Problem/Audit',
      ctaType: 'follow',
      ctaText: cta,
      linkedinPost: makePost(180, { cta }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'does not match post type',
    );
  });

  it('blocks competing CTAs', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'Follow for more, and share this with your team.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('competing CTAs');
  });

  it('blocks a CTA text that never appears in the post', () => {
    const content = makeContent({ ctaText: 'Save this before your quarterly planning session.' });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'CTA text does not appear in the post',
    );
  });
});

describe('ICP relevance and strategy assignment', () => {
  it('classifies a package that names a library pain signal as relevant', () => {
    const outcome = classifyIcpRelevance(makeContent(), strategy);
    expect(outcome.relevant).toBe(true);
  });

  it('rejects a package whose signals are not in the libraries', () => {
    const outcome = classifyIcpRelevance(
      makeContent({ painSignal: 'people feel unmotivated', dreamSignal: '' }),
      strategy,
    );
    expect(outcome.relevant).toBe(false);
    expect(outcome.reasons.join(' ')).toContain('No pain signal or dream signal');
  });

  it('accepts a dream signal on its own', () => {
    const outcome = classifyIcpRelevance(
      makeContent({ painSignal: '', dreamSignal: 'clear audit trails' }),
      strategy,
    );
    expect(outcome.relevant).toBe(true);
  });

  it('rejects a point of view that is not a configured belief', () => {
    const content = makeContent({ pointOfView: 'ship fast and see what happens' });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'not one of the configured category beliefs',
    );
  });

  it('accepts every configured belief as a point of view', () => {
    for (const belief of strategy.beliefs) {
      const result = runQualityGate(makeContent({ pointOfView: belief.id }), context());
      expect(result.failReasons).toEqual([]);
    }
  });
});

describe('honesty rules', () => {
  it('blocks a recency claim when current research was unavailable', () => {
    const content = makeContent({
      researchSource: `${NO_RESEARCH_MARKER}: Tavily returned HTTP 500.`,
      linkedinPost: makePost(180, { extra: 'A vendor just announced this yesterday.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('recency claim');
  });

  it('allows an evergreen post when research was unavailable', () => {
    const content = makeContent({
      researchSource: `${NO_RESEARCH_MARKER}: Tavily returned HTTP 500.`,
    });
    expect(runQualityGate(content, context()).failReasons).toEqual([]);
  });

  it('blocks an uncited revenue claim', () => {
    const content = makeContent({
      researchSource: `${NO_RESEARCH_MARKER}: no key configured.`,
      linkedinPost: makePost(180, { extra: 'That change added $40,000 in new revenue.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('money figure');
  });

  it('blocks an uncited percentage claim', () => {
    const content = makeContent({
      researchSource: `${NO_RESEARCH_MARKER}: no key configured.`,
      linkedinPost: makePost(180, { extra: 'It cut failures by 62% within a month.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('percentage');
  });

  it('blocks an attributed testimonial', () => {
    const content = makeContent({
      linkedinPost: makePost(180, {
        extra: '"This saved our operations team an entire week of manual work" — Dana, operations lead.',
      }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('testimonial');
  });

  it('blocks a claimed client engagement', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'One of my clients hit this exact wall.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'named or implied client engagement',
    );
  });

  it('blocks commentary with no concrete mechanism', () => {
    const hook = 'Most businesses misread their automation results';
    const post = [
      hook,
      '',
      'Teams keep talking about it. The conversation moves faster than the work does.',
      'Every business wants a better answer. Few of them write one down.',
      'It is easy to feel busy here.',
      '',
      'Save this for your next review.',
    ].join('\n');
    const content = makeContent({
      linkedinHook: hook,
      linkedinPost: post,
      ctaText: 'Save this for your next review.',
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'no concrete mechanism',
    );
  });
});

describe('authenticity and swipe-file protection', () => {
  it('blocks a founder story with no authenticity source', () => {
    const content = makeContent({
      postType: 'Founder/Practitioner Story',
      ctaType: 'follow',
      ctaText: 'Follow for practical automation breakdowns.',
      linkedinPost: makePost(180, { cta: 'Follow for practical automation breakdowns.' }),
      authenticitySource: '',
    });
    const reasons = runQualityGate(content, context()).failReasons.join(' ');
    expect(reasons).toContain('never invents lived experience');
  });

  it('blocks a founder story citing an entry that is not in the pack', () => {
    const cta = 'Follow for practical automation breakdowns.';
    const content = makeContent({
      postType: 'Founder/Practitioner Story',
      ctaType: 'follow',
      ctaText: cta,
      linkedinPost: makePost(180, { cta }),
      authenticitySource: 'idea-does-not-exist',
    });
    const reasons = runQualityGate(
      content,
      context({
        authenticityIdeas: [
          {
            id: 'idea-1',
            capturedAt: '2026-01-01T00:00:00.000Z',
            rawText: 'We rebuilt the retry path after a duplicate invoice went out.',
            sourceKind: 'mistake',
            tags: { audience: '', painSignal: '', dreamSignal: '', pointOfView: '', contentFormat: null },
            used: false,
          },
        ],
      }),
    ).failReasons.join(' ');
    expect(reasons).toContain('does not match any entry in the authenticity pack');
  });

  it('accepts a founder story attributed to a real pack entry', () => {
    const cta = 'Follow for practical automation breakdowns.';
    const content = makeContent({
      postType: 'Founder/Practitioner Story',
      ctaType: 'follow',
      ctaText: cta,
      linkedinPost: makePost(180, { cta }),
      authenticitySource: 'idea-1',
    });
    const result = runQualityGate(
      content,
      context({
        authenticityIdeas: [
          {
            id: 'idea-1',
            capturedAt: '2026-01-01T00:00:00.000Z',
            rawText: 'We rebuilt the retry path after a duplicate invoice went out.',
            sourceKind: 'mistake',
            tags: { audience: '', painSignal: '', dreamSignal: '', pointOfView: '', contentFormat: null },
            used: false,
          },
        ],
      }),
    );
    expect(result.failReasons).toEqual([]);
  });

  it('blocks a post that reproduces swipe-file wording', () => {
    const copied = 'the retry runs without state so one failed step repeats the same action twice';
    expect(longestSharedNgram(makePost(180), copied)).toBeGreaterThanOrEqual(8);
    const reasons = runQualityGate(
      makeContent(),
      context({
        swipeEntries: [
          {
            id: 'swipe-1',
            sourceUrl: '',
            creator: 'someone else',
            capturedAt: '2026-01-01T00:00:00.000Z',
            format: 'text',
            hookPattern: copied,
            structure: '',
            whyItWorks: '',
            audience: '',
            adaptationIdea: '',
            copiedText: false,
          },
        ],
      }),
    ).failReasons.join(' ');
    expect(reasons).toContain('Study the pattern, do not copy the words');
  });

  it('leaves a post alone when the swipe file only describes structure', () => {
    const result = runQualityGate(
      makeContent(),
      context({
        swipeEntries: [
          {
            id: 'swipe-2',
            sourceUrl: '',
            creator: 'someone else',
            capturedAt: '2026-01-01T00:00:00.000Z',
            format: 'audit',
            hookPattern: 'Names one costly symptom, then counts the checks.',
            structure: 'symptom, three checks, one fix, save CTA',
            whyItWorks: 'The reader can self-diagnose in under a minute.',
            audience: 'operators',
            adaptationIdea: 'Apply to observability gaps.',
            copiedText: false,
          },
        ],
      }),
    );
    expect(result.failReasons).toEqual([]);
  });
});

describe('duplicate topic prevention', () => {
  it('blocks a topic that repeats a recent post', () => {
    const reasons = runQualityGate(
      makeContent(),
      context({ recentTopics: ['retry semantics in internal lead-routing workflows'] }),
    ).failReasons.join(' ');
    expect(reasons).toContain('repeats a recent post');
  });

  it('allows a genuinely different topic', () => {
    const result = runQualityGate(
      makeContent(),
      context({ recentTopics: ['choosing an observability budget for support automation'] }),
    );
    expect(result.failReasons).toEqual([]);
  });
});

describe('image rules', () => {
  it('blocks needsImage with an empty prompt', () => {
    const content = makeContent({ needsImage: true, imagePrompt: '' });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'needsImage is true but imagePrompt is empty',
    );
  });

  it('blocks an image prompt that asks for a fake screenshot', () => {
    const content = makeContent({
      needsImage: true,
      imagePrompt: 'A photorealistic screenshot of a dashboard showing results',
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'fake screenshot or stock-photo look',
    );
  });

  it('blocks an image that repeats the caption', () => {
    const content = makeContent({
      needsImage: true,
      imagePrompt: makePost(180),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'repeats the caption instead of adding value',
    );
  });

  it('accepts a complementary diagram prompt', () => {
    const content = makeContent({
      needsImage: true,
      imagePrompt:
        'Minimal flat before/after diagram: left panel a linear chain of four boxes with no recovery arrow, right panel the same chain with a labelled recovery arrow and a queue. Clean background, one headline, no dense text.',
    });
    expect(runQualityGate(content, context()).failReasons).toEqual([]);
  });

  it('blocks an image prompt when needsImage is false', () => {
    const content = makeContent({ needsImage: false, imagePrompt: 'A diagram' });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'imagePrompt is set but needsImage is false',
    );
  });
});

describe('quality score', () => {
  it('scores a clean package at 100', () => {
    expect(runQualityGate(makeContent(), context()).qualityScore).toBe(100);
  });

  it('drops the score when checks fail', () => {
    const result = runQualityGate(makeContent({ linkedinPost: makePost(100) }), context());
    expect(result.qualityScore).toBeLessThan(100);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
  });
});
