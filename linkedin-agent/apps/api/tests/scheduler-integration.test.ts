import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import { WeekdayScheduler, SCHEDULER_TIMEZONE } from '../src/scheduler/weekday-scheduler.js';
import type { SchedulerSettings } from '../src/scheduler/weekday-scheduler.js';
import { loadRuns, schedulerRanToday } from '../src/store/run-log.js';
import { resetNegotiatedVersion } from '../src/providers/linkedin.js';
import { clearProviderEnv, makeContent, useTemporaryDataDir } from './fixtures.js';

const POST_URN = 'urn:li:share:7300000000000000123';
/** 21:00 Asia/Kolkata on Monday 7 September 2026. */
const MONDAY_9PM = new Date('2026-09-07T15:30:00.000Z');

let temp: { dir: string; cleanup: () => void };

function settings(): SchedulerSettings {
  return { enabled: true, hour: 21, minute: 0, timeZone: SCHEDULER_TIMEZONE, graceMinutes: 60 };
}

/**
 * A fetch that satisfies research, generation and publishing.
 * Each generation returns a distinct topic, as a working agent would.
 */
function liveFetch(): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const topics = [
    'retry semantics in internal lead-routing workflows',
    'observability budgets for unattended support automation',
    'state persistence across model timeouts in intake flows',
  ];
  let generation = 0;
  const impl = vi.fn(async (url: string | URL) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('api.tavily.com')) {
      return Response.json({
        results: [
          {
            title: 'Report',
            url: 'https://example.com/r',
            published_date: '2026-09-01',
            content: 'Retry logic without state causes duplicate side effects.',
          },
        ],
      });
    }
    if (href.includes('generativelanguage')) {
      const topic = topics[generation % topics.length] ?? topics[0]!;
      generation += 1;
      return Response.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(makeContent({ topic })) }] } },
        ],
      });
    }
    if (href.includes('api.linkedin.com/rest/posts')) {
      return new Response('{}', { status: 201, headers: { 'x-restli-id': POST_URN } });
    }
    throw new Error(`Unexpected fetch to ${href}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  resetNegotiatedVersion();
  process.env.GEMINI_API_KEY = 'k';
  process.env.TAVILY_API_KEY = 'k';
  process.env.LINKEDIN_ACCESS_TOKEN = 'k';
  process.env.LINKEDIN_PERSON_URN = 'urn:li:person:AbC123';
  process.env.SOCIAL_CONTENT_SCHEDULER_ENABLED = 'true';
  process.env.SOCIAL_CONTENT_DRY_RUN = 'false';
  resetConfigCache();
});

afterEach(() => {
  temp.cleanup();
  for (const key of ['GEMINI_API_KEY', 'SOCIAL_CONTENT_SCHEDULER_ENABLED', 'SOCIAL_CONTENT_DRY_RUN']) {
    delete process.env[key];
  }
  resetNegotiatedVersion();
  clearProviderEnv();
});

describe('unattended weekday publishing', () => {
  it('publishes at 21:00 IST with no human in the loop', async () => {
    const { impl, calls } = liveFetch();
    const scheduler = new WeekdayScheduler(settings());

    const decision = await scheduler.tick(MONDAY_9PM, impl);

    expect(decision.run).toBe(true);
    expect(calls.some((call) => call.includes('api.linkedin.com/rest/posts'))).toBe(true);

    const runs = loadRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger).toBe('scheduler');
    expect(runs[0]?.status).toBe('published');
    expect(runs[0]?.linkedinPostId).toBe(POST_URN);
    // No confirmation prompt: the scheduler is authorised by its own env flag.
    expect(scheduler.getState().lastRunStatus).toBe('published');
  });

  it('does not publish twice when ticked repeatedly through the window', async () => {
    const { impl, calls } = liveFetch();
    const scheduler = new WeekdayScheduler(settings());

    await scheduler.tick(MONDAY_9PM, impl);
    await scheduler.tick(new Date('2026-09-07T15:30:40.000Z'), impl);
    await scheduler.tick(new Date('2026-09-07T15:50:00.000Z'), impl);

    expect(calls.filter((call) => call.includes('/rest/posts'))).toHaveLength(1);
    expect(loadRuns()).toHaveLength(1);
  });

  it('does not publish twice after a restart mid-window', async () => {
    const { impl, calls } = liveFetch();

    await new WeekdayScheduler(settings()).tick(MONDAY_9PM, impl);
    // A fresh process: in-memory state is gone, the run log on the volume is not.
    await new WeekdayScheduler(settings()).tick(new Date('2026-09-07T15:35:00.000Z'), impl);

    expect(calls.filter((call) => call.includes('/rest/posts'))).toHaveLength(1);
    expect(schedulerRanToday(SCHEDULER_TIMEZONE, MONDAY_9PM)).not.toBeNull();
  });

  it('still posts when the process only comes up after the scheduled minute', async () => {
    const { impl, calls } = liveFetch();
    // Deployed at 21:18 — the old exact-minute trigger would have lost the day.
    const decision = await new WeekdayScheduler(settings()).tick(
      new Date('2026-09-07T15:48:00.000Z'),
      impl,
    );

    expect(decision.run).toBe(true);
    expect(calls.filter((call) => call.includes('/rest/posts'))).toHaveLength(1);
  });

  it('never publishes on a Saturday', async () => {
    const { impl, calls } = liveFetch();
    // 21:00 IST on Saturday 12 September 2026.
    const decision = await new WeekdayScheduler(settings()).tick(
      new Date('2026-09-12T15:30:00.000Z'),
      impl,
    );

    expect(decision).toEqual({ run: false, reason: 'weekend' });
    expect(calls).toHaveLength(0);
  });

  it('runs the next weekday after a successful day', async () => {
    const { impl, calls } = liveFetch();
    await new WeekdayScheduler(settings()).tick(MONDAY_9PM, impl);
    await new WeekdayScheduler(settings()).tick(new Date('2026-09-08T15:30:00.000Z'), impl);

    expect(calls.filter((call) => call.includes('/rest/posts'))).toHaveLength(2);
    expect(loadRuns()).toHaveLength(2);
  });

  it('blocks a repeat of yesterday\'s topic instead of publishing it', async () => {
    const calls: string[] = [];
    const sameContent = makeContent();
    const impl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('api.tavily.com')) return new Response('{}', { status: 403 });
      if (href.includes('generativelanguage')) {
        return Response.json({
          candidates: [{ content: { parts: [{ text: JSON.stringify(sameContent) }] } }],
        });
      }
      return new Response('{}', { status: 201, headers: { 'x-restli-id': POST_URN } });
    }) as unknown as typeof fetch;

    await new WeekdayScheduler(settings()).tick(MONDAY_9PM, impl);
    await new WeekdayScheduler(settings()).tick(new Date('2026-09-08T15:30:00.000Z'), impl);

    const runs = loadRuns();
    expect(runs[0]?.status).toBe('published');
    expect(runs[1]?.status).toBe('quality_blocked');
    expect(runs[1]?.qualityReasons.join(' ')).toContain('repeats a recent post');
    // Only the first day reached LinkedIn.
    expect(calls.filter((call) => call.includes('/rest/posts'))).toHaveLength(1);
  });

  it('does not retry the same day after a failure, so one outage costs one post', async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).includes('api.tavily.com')) return new Response('{}', { status: 403 });
      // Gemini is down with a non-transient error.
      return new Response('{}', { status: 400 });
    }) as unknown as typeof fetch;

    await new WeekdayScheduler(settings()).tick(MONDAY_9PM, impl);
    const afterFirst = calls.length;
    await new WeekdayScheduler(settings()).tick(new Date('2026-09-07T15:40:00.000Z'), impl);

    expect(loadRuns()[0]?.status).toBe('failed');
    // The failed attempt is recorded, so the window does not become a retry loop.
    expect(calls.length).toBe(afterFirst);
  });
});
