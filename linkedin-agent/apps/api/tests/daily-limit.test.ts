import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import { runLinkedInContentWorkflow } from '../src/workflows/linkedin-content-workflow.js';
import { appendRun, publishedToday } from '../src/store/run-log.js';
import type { RunRecord } from '../src/store/run-log.js';
import { clearProviderEnv, useTemporaryDataDir } from './fixtures.js';

const IST = 'Asia/Kolkata';
let temp: { dir: string; cleanup: () => void };

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: `run-${Math.random()}`,
    timestamp: '2026-09-07T15:30:00.000Z',
    trigger: 'scheduler',
    status: 'published',
    postType: 'Named Problem',
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

beforeEach(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.LINKEDIN_ACCESS_TOKEN = 'test-token';
  process.env.LINKEDIN_PERSON_URN = 'urn:li:person:AbC123';
  resetConfigCache();
});

afterEach(() => {
  temp.cleanup();
  delete process.env.GEMINI_API_KEY;
  clearProviderEnv();
});

describe('publishedToday', () => {
  it('finds a post published earlier the same IST day', () => {
    // 15:30Z is 21:00 IST on 7 Sep.
    appendRun(record({ timestamp: '2026-09-07T15:30:00.000Z' }));
    expect(publishedToday(IST, new Date('2026-09-07T17:00:00.000Z'))).not.toBeNull();
  });

  it('ignores a post from the previous IST day', () => {
    appendRun(record({ timestamp: '2026-09-07T15:30:00.000Z' }));
    expect(publishedToday(IST, new Date('2026-09-08T15:25:00.000Z'))).toBeNull();
  });

  it('ignores runs that never published', () => {
    appendRun(record({ status: 'quality_blocked', linkedinPostId: null, qualityPassed: false }));
    appendRun(record({ status: 'dry_run', linkedinPostId: null }));
    expect(publishedToday(IST, new Date('2026-09-07T17:00:00.000Z'))).toBeNull();
  });

  it('counts a partially published run', () => {
    appendRun(record({ status: 'partially_published' }));
    expect(publishedToday(IST, new Date('2026-09-07T17:00:00.000Z'))).not.toBeNull();
  });
});

describe('one primary post per weekday', () => {
  it('spends no Gemini quota when a post already went out today', async () => {
    appendRun(record({ timestamp: '2026-09-07T15:30:00.000Z' }));
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await runLinkedInContentWorkflow({
      trigger: 'scheduler',
      dryRun: false,
      now: new Date('2026-09-07T17:00:00.000Z'),
      fetchImpl,
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('duplicate_run');
    expect(result.error?.message).toContain('already published today');
    // The whole point: no research call, no generation call, no quota burned.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still allows a draft on a day that already published', async () => {
    appendRun(record({ timestamp: '2026-09-07T15:30:00.000Z' }));
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('generativelanguage')) {
        return Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
      }
      return new Response('{}', { status: 400 });
    }) as unknown as typeof fetch;

    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      now: new Date('2026-09-07T17:00:00.000Z'),
      fetchImpl,
    });

    // Drafting is allowed; it is publishing that is capped at one a day.
    expect(result.error?.code).not.toBe('duplicate_run');
  });

  it('allows a dry run on a day that already published', async () => {
    appendRun(record({ timestamp: '2026-09-07T15:30:00.000Z' }));
    const fetchImpl = vi.fn(async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }),
    ) as unknown as typeof fetch;

    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: true,
      now: new Date('2026-09-07T17:00:00.000Z'),
      fetchImpl,
    });
    expect(result.error?.code).not.toBe('duplicate_run');
  });

  it('publishes a second post only when explicitly authorised', async () => {
    appendRun(record({ timestamp: '2026-09-07T15:30:00.000Z' }));
    // 400 is not retried, so generation fails immediately. This test only
    // cares that the call was attempted at all.
    const fetchImpl = vi.fn(async () =>
      new Response('{}', { status: 400 }),
    ) as unknown as typeof fetch;

    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      allowSecondPostToday: true,
      now: new Date('2026-09-07T17:00:00.000Z'),
      fetchImpl,
    });

    expect(result.error?.code).not.toBe('duplicate_run');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('runs normally on a day with no post yet', async () => {
    appendRun(record({ timestamp: '2026-09-07T15:30:00.000Z' }));
    const fetchImpl = vi.fn(async () =>
      new Response('{}', { status: 400 }),
    ) as unknown as typeof fetch;

    await runLinkedInContentWorkflow({
      trigger: 'scheduler',
      dryRun: false,
      now: new Date('2026-09-08T15:30:00.000Z'),
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalled();
  });
});
