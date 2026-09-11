import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStrategy } from '../src/agents/linkedin-content-agent/strategy.js';
import type { Strategy } from '../src/agents/linkedin-content-agent/strategy.js';
import { runQualityGate } from '../src/validation/quality-gate.js';
import type { QualityGateContext } from '../src/validation/quality-gate.js';
import { seedAuthenticityPackIfEmpty, loadAuthenticityPack } from '../src/store/authenticity-pack.js';
import { isTransientGeminiError } from '../src/providers/gemini.js';
import { AppError } from '../src/lib/errors.js';
import { clearProviderEnv, makeContent, makePost, useTemporaryDataDir } from './fixtures.js';

let strategy: Strategy;
let temp: { dir: string; cleanup: () => void };

function context(): QualityGateContext {
  return {
    strategy,
    minWords: 150,
    maxWords: 220,
    destinations: { PROFILE_URL: '', PUBLIC_RESOURCE_URL: '', CASE_STUDY_URL: '', CALENDAR_URL: '' },
    swipeEntries: [],
    authenticityIdeas: [],
    recentTopics: [],
  };
}

beforeAll(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  strategy = loadStrategy();
});

afterAll(() => temp.cleanup());

describe('AI marker density (cluster principle)', () => {
  it('allows one or two markers — that is just English', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'A robust queue is essentially the whole fix.' }),
    });
    expect(runQualityGate(content, context()).failReasons).toEqual([]);
  });

  it('blocks a cluster of three or more', () => {
    const content = makeContent({
      linkedinPost: makePost(180, {
        extra: 'We leverage a robust and seamless ecosystem to streamline the journey.',
      }),
    });
    const reasons = runQualityGate(content, context()).failReasons.join(' ');
    expect(reasons).toContain('Reads machine-written');
    expect(reasons).toContain('leverage');
  });
});

describe('negative parallelism', () => {
  it('blocks "it\'s not just X, it\'s Y" at any density', () => {
    const content = makeContent({
      linkedinPost: makePost(180, {
        extra: "It's not just a model problem, it's a routing problem.",
      }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
      'Negative parallelism',
    );
  });

  it('leaves an ordinary negative alone', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'That is not the model failing. The queue is.' }),
    });
    expect(runQualityGate(content, context()).failReasons).toEqual([]);
  });
});

describe('em dash density', () => {
  it('permits sparing use', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'One step fails — the rest keep going.' }),
    });
    expect(runQualityGate(content, context()).failReasons).toEqual([]);
  });

  it('blocks em dash pile-up', () => {
    const content = makeContent({
      linkedinPost: makePost(180, {
        extra: 'One — then another — and another — and one more — again.',
      }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('em dashes');
  });

  it('blocks a double hyphen used as a dash', () => {
    const content = makeContent({
      linkedinPost: makePost(180, { extra: 'The retry fires again -- and bills twice.' }),
    });
    expect(runQualityGate(content, context()).failReasons.join(' ')).toContain('Double hyphen');
  });
});

describe('phrases ported as hard bans', () => {
  for (const phrase of ['at the end of the day', 'deep dive', 'best-in-class']) {
    it(`blocks "${phrase}"`, () => {
      const content = makeContent({
        linkedinPost: makePost(180, { extra: `This is a ${phrase} consideration.` }),
      });
      expect(runQualityGate(content, context()).failReasons.join(' ')).toContain(
        'Banned AI phrasing',
      );
    });
  }
});

describe('the comment-gate hook stays blocked', () => {
  it('rejects F6 even though the bundle recommends it', () => {
    // sergebulaev/linkedin-skills F6 "Comment-Gate Lead Magnet" ends with
    // "I'll DM the link personally". This system has no DMs, so it is a lie.
    const cta = "Free. No email wall. I'll DM the link personally.";
    const content = makeContent({ ctaText: cta, linkedinPost: makePost(180, { cta }) });
    const result = runQualityGate(content, context());
    expect(result.passed).toBe(false);
    expect(result.unsupportedAutomationDetected).toBe(true);
  });
});

describe('Gemini timeout is retried', () => {
  it('treats a timeout as transient', () => {
    // The 2026-09-09 scheduled post was lost to exactly this.
    expect(isTransientGeminiError(new AppError('gemini_failed', 'Gemini request timed out.'))).toBe(
      true,
    );
  });

  it('still does not retry quota or a client error', () => {
    expect(isTransientGeminiError(new AppError('gemini_quota', 'quota', { httpStatus: 429 }))).toBe(
      false,
    );
    expect(
      isTransientGeminiError(new AppError('gemini_failed', 'bad request', { httpStatus: 400 })),
    ).toBe(false);
  });
});

describe('authenticity pack seeding', () => {
  it('provisions an empty volume from the committed seed', () => {
    const local = useTemporaryDataDir();
    try {
      expect(loadAuthenticityPack().ideas).toHaveLength(0);
      const outcome = seedAuthenticityPackIfEmpty();
      expect(outcome.seeded).toBe(true);
      expect(outcome.ideas).toBeGreaterThan(0);
      expect(loadAuthenticityPack().ideas.length).toBe(outcome.ideas);
    } finally {
      local.cleanup();
    }
  });

  it('never overwrites a pack the operator already has', () => {
    const local = useTemporaryDataDir();
    try {
      seedAuthenticityPackIfEmpty();
      const before = loadAuthenticityPack().ideas.length;
      const second = seedAuthenticityPackIfEmpty();
      expect(second.seeded).toBe(false);
      expect(loadAuthenticityPack().ideas).toHaveLength(before);
    } finally {
      local.cleanup();
    }
  });
});
