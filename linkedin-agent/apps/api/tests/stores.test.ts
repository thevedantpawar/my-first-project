import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ingestAuthenticityPack,
  loadAuthenticityPack,
  markAuthenticityIdeaUsed,
  suggestAuthenticityIdeas,
} from '../src/store/authenticity-pack.js';
import { addSwipeFileEntry, loadSwipeFile, SwipeFileRejected } from '../src/store/swipe-file.js';
import { appendRun, lastRun, loadRuns, recentTopics } from '../src/store/run-log.js';
import { buildProfileAudit } from '../src/profile/profile-audit.js';
import { clearProviderEnv, useTemporaryDataDir } from './fixtures.js';

let temp: { dir: string; cleanup: () => void };

beforeEach(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
});

afterEach(() => temp.cleanup());

describe('authenticity pack', () => {
  it('splits pasted notes on blank lines and keeps the original wording', () => {
    const pack = ingestAuthenticityPack({
      rawNotes: 'We shipped the retry fix on a Sunday.\n\nI still think demos are a distraction.',
      replace: false,
    });
    expect(pack.ideas).toHaveLength(2);
    expect(pack.ideas[0]?.rawText).toBe('We shipped the retry fix on a Sunday.');
    expect(pack.ideas[0]?.sourceKind).toBe('other');
  });

  it('keeps structured ideas with their tags', () => {
    const pack = ingestAuthenticityPack({
      ideas: [
        {
          rawText: 'A duplicate invoice went out because the retry had no idempotency key.',
          sourceKind: 'mistake',
          tags: { painSignal: 'retries create duplicate actions or surprise bills' },
        },
      ],
      replace: false,
    });
    expect(pack.ideas[0]?.sourceKind).toBe('mistake');
    expect(pack.ideas[0]?.tags.painSignal).toContain('duplicate actions');
    expect(pack.ideas[0]?.tags.contentFormat).toBeNull();
  });

  it('appends by default and replaces on request', () => {
    ingestAuthenticityPack({ rawNotes: 'First note.', replace: false });
    ingestAuthenticityPack({ rawNotes: 'Second note.', replace: false });
    expect(loadAuthenticityPack().ideas).toHaveLength(2);
    ingestAuthenticityPack({ rawNotes: 'Only note.', replace: true });
    expect(loadAuthenticityPack().ideas).toHaveLength(1);
  });

  it('suggests unused ideas first', () => {
    ingestAuthenticityPack({ rawNotes: 'Note one.\n\nNote two.', replace: true });
    const [first] = loadAuthenticityPack().ideas;
    markAuthenticityIdeaUsed(first!.id);
    expect(suggestAuthenticityIdeas(2)[0]?.id).not.toBe(first!.id);
  });
});

describe('swipe file', () => {
  it('stores a pattern entry', () => {
    const entry = addSwipeFileEntry({
      sourceUrl: 'https://example.com/post',
      creator: 'Another operator',
      format: 'audit',
      hookPattern: 'One symptom, then a numbered set of checks.',
      structure: 'symptom, checks, fix, CTA',
      whyItWorks: 'The reader can self-diagnose fast.',
      audience: 'ops leads',
      adaptationIdea: 'Apply to retry semantics.',
      copiedText: false,
    });
    expect(entry.copiedText).toBe(false);
    expect(loadSwipeFile()).toHaveLength(1);
  });

  it('refuses an entry that admits to copying text', () => {
    expect(() =>
      addSwipeFileEntry({
        sourceUrl: '',
        creator: '',
        format: 'text',
        hookPattern: '',
        structure: '',
        whyItWorks: '',
        audience: '',
        adaptationIdea: '',
        copiedText: true,
      }),
    ).toThrowError(SwipeFileRejected);
    expect(loadSwipeFile()).toHaveLength(0);
  });
});

describe('run log', () => {
  function record(overrides: Record<string, unknown> = {}) {
    return {
      id: `run-${Math.random()}`,
      timestamp: new Date().toISOString(),
      trigger: 'manual_run' as const,
      status: 'published' as const,
      postType: 'Named Problem' as const,
      topic: 'retry semantics',
      researchSource: 'source',
      hook: 'hook',
      linkedinPost: 'post',
      qualityPassed: true,
      qualityScore: 100,
      qualityReasons: [],
      linkedinHttpStatus: 201,
      linkedinPostId: 'urn:li:share:1',
      imageStatus: 'not_requested',
      loggingStatus: 'skipped',
      errorMessage: '',
      ...overrides,
    };
  }

  it('appends and reads back the last run', () => {
    appendRun(record({ topic: 'first' }));
    appendRun(record({ topic: 'second' }));
    expect(loadRuns()).toHaveLength(2);
    expect(lastRun()?.topic).toBe('second');
  });

  it('collects recent published topics only', () => {
    appendRun(record({ topic: 'published topic' }));
    appendRun(record({ topic: 'blocked topic', status: 'quality_blocked', qualityPassed: false }));
    appendRun(
      record({
        topic: 'old topic',
        timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    const topics = recentTopics(28);
    expect(topics).toContain('published topic');
    expect(topics).not.toContain('blocked topic');
    expect(topics).not.toContain('old topic');
  });
});

describe('profile audit', () => {
  it('warns about every incomplete item and every unconfigured destination', () => {
    const report = buildProfileAudit();
    expect(report.total).toBeGreaterThan(0);
    expect(report.warnings.join(' ')).toContain('PROFILE_URL is not configured');
    expect(report.warnings.join(' ')).toContain('No proof recorded');
  });
});
