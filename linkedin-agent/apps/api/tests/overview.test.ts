import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import { loadStrategy } from '../src/agents/linkedin-content-agent/strategy.js';
import type { Strategy } from '../src/agents/linkedin-content-agent/strategy.js';
import { buildOverview, projectPipeline } from '../src/analytics/overview.js';
import type { Overview } from '../src/analytics/overview.js';
import { postMetricsSchema } from '../src/store/analytics.js';
import type { PostMetrics } from '../src/store/analytics.js';
import { runRecordSchema } from '../src/store/run-log.js';
import type { RunRecord } from '../src/store/run-log.js';
import { clearProviderEnv, useTemporaryDataDir } from './fixtures.js';

const NOW = new Date('2026-09-11T19:00:00.000Z');
let strategy: Strategy;
let temp: { dir: string; cleanup: () => void };

const SCHEDULE: Overview['schedule'] = {
  enabled: true,
  dryRun: false,
  timeZone: 'Asia/Kolkata',
  scheduledTime: '21:00',
  nextRunAt: '2026-09-14T15:30:00.000Z',
  secondsUntilNextRun: 1000,
};

function run(overrides: Partial<RunRecord> & { timestamp: string }): RunRecord {
  return runRecordSchema.parse({
    id: `r-${Math.random()}`,
    trigger: 'scheduler',
    status: 'published',
    postType: 'Named Problem',
    topic: 'retries',
    researchSource: 's',
    hook: 'h',
    linkedinPost: 'p',
    qualityPassed: true,
    qualityScore: 100,
    qualityReasons: [],
    linkedinHttpStatus: 201,
    linkedinPostId: 'urn:li:share:1',
    ...overrides,
  });
}

function post(overrides: Partial<PostMetrics> & { postId: string }): PostMetrics {
  return postMetricsSchema.parse({
    publishedAt: '2026-08-15T15:30:00.000Z',
    postType: 'Named Problem',
    ctaType: 'save',
    ...overrides,
  });
}

function overview(runs: RunRecord[], posts: PostMetrics[] = [], samples: { date: string; followers: number }[] = []) {
  return buildOverview({ runs, posts, followerSamples: samples, strategy, schedule: SCHEDULE, now: NOW });
}

beforeEach(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  resetConfigCache();
  strategy = loadStrategy();
});

afterEach(() => temp.cleanup());

describe('publishing health', () => {
  it('counts a real week correctly', () => {
    const result = overview([
      run({ timestamp: '2026-09-07T15:30:00.000Z' }),
      run({ timestamp: '2026-09-08T15:30:00.000Z' }),
      run({ timestamp: '2026-09-09T15:31:00.000Z', status: 'failed', qualityPassed: false }),
      run({ timestamp: '2026-09-10T15:30:00.000Z' }),
      run({ timestamp: '2026-09-11T15:30:00.000Z' }),
    ]);
    expect(result.publishing.published).toBe(4);
    expect(result.publishing.failed).toBe(1);
    // Mon-Fri published except Wednesday: the streak is Thu + Fri.
    expect(result.publishing.currentStreak).toBe(2);
  });

  it('marks weekends as weekends, not as misses', () => {
    const result = overview([]);
    const weekend = result.calendar.filter((cell) => cell.weekday > 5);
    expect(weekend.length).toBeGreaterThan(0);
    expect(weekend.every((cell) => cell.status === 'weekend')).toBe(true);
    expect(result.publishing.missed).toBe(result.publishing.weekdaysElapsed);
  });

  it('counts revision rescues', () => {
    const result = overview([
      run({ timestamp: '2026-09-10T15:30:00.000Z', revisionRescued: true }),
      run({ timestamp: '2026-09-11T15:30:00.000Z' }),
    ]);
    expect(result.publishing.revisionRescues).toBe(1);
  });
});

describe('follower pacing to the target', () => {
  it('reports the gap and the weekly rate needed', () => {
    const result = overview([], [], [{ date: '2026-09-01', followers: 180 }]);
    expect(result.followers.target).toBe(1000);
    expect(result.followers.gapToTarget).toBe(820);
    expect(result.followers.weeksRemaining).toBeGreaterThan(0);
    expect(result.followers.neededPerWeek).toBeGreaterThan(0);
    expect(result.followers.guaranteed).toBe(false);
  });

  it('says so plainly when there is no sample', () => {
    const result = overview([]);
    expect(result.followers.current).toBeNull();
    expect(result.followers.gapToTarget).toBeNull();
    expect(result.followers.pacing).toBe('unknown');
  });
});

describe('pipeline projection', () => {
  it('refuses to project without a deal value', () => {
    const projection = projectPipeline([], { ...strategy.economics, averageDealValueUsd: 0 }, NOW);
    expect(projection.configured).toBe(false);
    expect(projection.projectedRevenuePerMonth).toBeNull();
    expect(projection.assumptions.join(' ')).toContain('averageDealValueUsd is 0');
  });

  it('projects from recorded conversations once a deal value is set', () => {
    const posts = [
      post({ postId: 'a', publishedAt: '2026-08-12T00:00:00Z', qualifiedConversations: 4 }),
      post({ postId: 'b', publishedAt: '2026-09-05T00:00:00Z', qualifiedConversations: 2 }),
    ];
    const projection = projectPipeline(
      posts,
      { averageDealValueUsd: 5000, grossMarginPercent: 70, conversationToCallRate: 0.5, callToDealRate: 0.2 },
      NOW,
    );
    expect(projection.configured).toBe(true);
    expect(projection.qualifiedConversationsPerMonth).toBeGreaterThan(0);
    expect(projection.projectedRevenuePerMonth).toBeGreaterThan(0);
    expect(projection.projectedGrossProfitPerMonth).toBeCloseTo(
      (projection.projectedRevenuePerMonth ?? 0) * 0.7,
      5,
    );
    // No calls recorded, so the rate is still the operator's assumption.
    expect(projection.usingRecordedRates).toBe(false);
    expect(projection.assumptions.join(' ')).toContain('an assumption you set');
  });

  it('prefers measured conversion over the configured guess', () => {
    const posts = [
      post({
        postId: 'a',
        publishedAt: '2026-08-12T00:00:00Z',
        qualifiedConversations: 10,
        bookedCalls: 8,
      }),
    ];
    const projection = projectPipeline(
      posts,
      { averageDealValueUsd: 5000, grossMarginPercent: 70, conversationToCallRate: 0.1, callToDealRate: 0.25 },
      NOW,
    );
    expect(projection.usingRecordedRates).toBe(true);
    // 80% measured, not the 10% configured.
    expect(projection.assumptions.join(' ')).toContain('80%');
    expect(projection.assumptions.join(' ')).toContain('measured from your entries');
  });

  it('never turns a follower count into money', () => {
    // Followers are not an input to the projection at all.
    const withFollowers = overview([], [], [{ date: '2026-09-01', followers: 5000 }]);
    expect(withFollowers.pipeline.projectedRevenuePerMonth).toBeNull();
  });

  it('always carries the caveat', () => {
    expect(projectPipeline([], strategy.economics, NOW).caveat).toMatch(/not a forecast/i);
  });
});

describe('funnel', () => {
  it('reports unrecorded steps as null rather than zero', () => {
    const result = overview([], [post({ postId: 'a', impressions: 1000, profileViews: 40 })]);
    const byLabel = Object.fromEntries(result.funnel.map((step) => [step.label, step]));
    expect(byLabel['Impressions']?.value).toBe(1000);
    expect(byLabel['Profile views']?.rateFromPrevious).toBeCloseTo(0.04);
    expect(byLabel['Booked calls']?.value).toBeNull();
  });
});

describe('formula usage', () => {
  it('counts only formulas actually used', () => {
    const result = overview([
      run({ timestamp: '2026-09-10T15:30:00.000Z', hookFormulaId: 'F10' }),
      run({ timestamp: '2026-09-11T15:30:00.000Z', hookFormulaId: 'F10' }),
    ]);
    expect(result.formulaUsage[0]).toMatchObject({ id: 'F10', uses: 2 });
    expect(result.formulaUsage).toHaveLength(1);
  });
});
