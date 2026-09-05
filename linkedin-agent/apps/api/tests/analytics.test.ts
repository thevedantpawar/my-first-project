import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStrategy } from '../src/agents/linkedin-content-agent/strategy.js';
import type { Strategy } from '../src/agents/linkedin-content-agent/strategy.js';
import {
  aggregateTotals,
  computePostRates,
  followerProgress,
  rankByAudienceRelevance,
  rankByBusinessOutcome,
  rankByDistribution,
} from '../src/analytics/metrics.js';
import { buildMonthlyReview } from '../src/analytics/monthly-review.js';
import { postMetricsSchema } from '../src/store/analytics.js';
import type { PostMetrics } from '../src/store/analytics.js';
import { clearProviderEnv, useTemporaryDataDir } from './fixtures.js';

let strategy: Strategy;
let temp: { dir: string; cleanup: () => void };

beforeAll(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  strategy = loadStrategy();
});

afterAll(() => temp.cleanup());

function post(overrides: Partial<PostMetrics> & { postId: string }): PostMetrics {
  return postMetricsSchema.parse({
    publishedAt: '2026-09-01T15:30:00.000Z',
    postType: 'Named Problem',
    ctaType: 'save',
    ...overrides,
  });
}

describe('rate calculations', () => {
  it('computes every rate from recorded numbers', () => {
    const rates = computePostRates(
      post({
        postId: 'a',
        impressions: 1000,
        reactions: 40,
        comments: 8,
        reposts: 2,
        saves: 10,
        profileViews: 25,
        linkClicks: 15,
        qualifiedConversations: 4,
        bookedCalls: 1,
        attributedRevenue: 5000,
        cost: 200,
      }),
    );
    expect(rates.engagementRate).toBeCloseTo(0.05);
    expect(rates.repostRate).toBeCloseTo(0.002);
    expect(rates.profileConversionRate).toBeCloseTo(0.025);
    expect(rates.qualifiedActionRate).toBeCloseTo(0.05);
    expect(rates.leadConversionRate).toBeCloseTo(0.25);
    expect(rates.profitPerPost).toBe(4800);
  });

  it('returns null rather than zero when a metric was never recorded', () => {
    const rates = computePostRates(post({ postId: 'b' }));
    expect(rates.engagementRate).toBeNull();
    expect(rates.profileConversionRate).toBeNull();
    expect(rates.profitPerPost).toBeNull();
  });

  it('does not divide by zero impressions', () => {
    const rates = computePostRates(post({ postId: 'c', impressions: 0, reactions: 5 }));
    expect(rates.engagementRate).toBeNull();
  });

  it('treats a recorded revenue with no cost as full profit', () => {
    expect(computePostRates(post({ postId: 'd', attributedRevenue: 900 })).profitPerPost).toBe(900);
  });

  it('sums only the metrics that exist', () => {
    const totals = aggregateTotals([
      post({ postId: 'a', impressions: 100, saves: 3 }),
      post({ postId: 'b', impressions: 200 }),
    ]);
    expect(totals.posts).toBe(2);
    expect(totals.impressions).toBe(300);
    expect(totals.saves).toBe(3);
    expect(totals.bookedCalls).toBeNull();
  });
});

describe('rankings', () => {
  const viral = post({ postId: 'viral', impressions: 50_000, reactions: 900, reposts: 60 });
  const converting = post({
    postId: 'converting',
    impressions: 2000,
    reactions: 40,
    reposts: 2,
    profileViews: 180,
    saves: 60,
    qualifiedConversations: 6,
    bookedCalls: 3,
  });

  it('puts business outcome above reach', () => {
    expect(rankByBusinessOutcome([viral, converting])[0]?.postId).toBe('converting');
  });

  it('puts audience relevance above reach', () => {
    expect(rankByAudienceRelevance([viral, converting])[0]?.postId).toBe('converting');
  });

  it('still reports distribution separately', () => {
    expect(rankByDistribution([converting, viral])[0]?.postId).toBe('viral');
  });
});

describe('follower pacing', () => {
  it('reports unknown with no samples', () => {
    const progress = followerProgress([], 10_000, 4);
    expect(progress.pacing).toBe('unknown');
    expect(progress.guaranteed).toBe(false);
  });

  it('reports behind when growth trails the straight line', () => {
    const progress = followerProgress(
      [
        { date: '2026-01-01', followers: 500 },
        { date: '2026-03-01', followers: 900 },
      ],
      10_000,
      4,
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(progress.pacing).toBe('behind');
  });

  it('reports ahead when growth outruns the straight line', () => {
    const progress = followerProgress(
      [
        { date: '2026-01-01', followers: 500 },
        { date: '2026-03-01', followers: 8000 },
      ],
      10_000,
      4,
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(progress.pacing).toBe('ahead');
  });

  it('never claims the target is guaranteed', () => {
    const progress = followerProgress(
      [{ date: '2026-01-01', followers: 500 }],
      10_000,
      4,
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(progress.guaranteed).toBe(false);
    expect(progress.note).toContain('not a guarantee');
  });
});

describe('monthly review', () => {
  const now = new Date('2026-09-30T00:00:00Z');

  it('says so plainly when there is nothing to analyse', () => {
    const review = buildMonthlyReview([], [], strategy, { now });
    expect(review.postsAnalyzed).toBe(0);
    expect(review.recommendations[0]).toContain('No metrics recorded');
  });

  it('ignores posts outside the window', () => {
    const review = buildMonthlyReview(
      [post({ postId: 'old', publishedAt: '2026-05-01T00:00:00Z', impressions: 1000 })],
      [],
      strategy,
      { now },
    );
    expect(review.postsAnalyzed).toBe(0);
  });

  it('recommends doubling down on the format with the most qualified action', () => {
    const posts = [
      post({
        postId: 'audit-1',
        publishedAt: '2026-09-10T00:00:00Z',
        postType: 'Surfaced Problem/Audit',
        impressions: 3000,
        saves: 40,
        profileViews: 90,
        bookedCalls: 2,
      }),
      post({
        postId: 'audit-2',
        publishedAt: '2026-09-12T00:00:00Z',
        postType: 'Surfaced Problem/Audit',
        impressions: 2500,
        saves: 30,
        profileViews: 70,
        bookedCalls: 1,
      }),
      post({
        postId: 'pov-1',
        publishedAt: '2026-09-14T00:00:00Z',
        postType: 'Point-of-View',
        impressions: 20_000,
      }),
      post({
        postId: 'pov-2',
        publishedAt: '2026-09-16T00:00:00Z',
        postType: 'Point-of-View',
        impressions: 30_000,
      }),
    ];
    const review = buildMonthlyReview(posts, [], strategy, { now });
    expect(review.postsAnalyzed).toBe(4);
    expect(review.byBusinessOutcome[0]?.postId).toBe('audit-1');
    expect(review.winning.postTypes[0]?.postType).toBe('Surfaced Problem/Audit');
    const joined = review.recommendations.join(' ');
    expect(joined).toContain('Surfaced Problem/Audit');
    expect(joined).toContain('no qualified conversation');
  });

  it('flags a small sample as a hypothesis rather than a finding', () => {
    const review = buildMonthlyReview(
      [post({ postId: 'x', publishedAt: '2026-09-20T00:00:00Z', impressions: 100 })],
      [],
      strategy,
      { now },
    );
    expect(review.recommendations.join(' ')).toContain('hypothesis');
  });

  it('stays inconclusive about images without enough of each kind', () => {
    const review = buildMonthlyReview(
      [post({ postId: 'x', publishedAt: '2026-09-20T00:00:00Z', hadImage: true })],
      [],
      strategy,
      { now },
    );
    expect(review.winning.visualPattern).toBe('inconclusive');
  });

  it('carries the follower target through without promising it', () => {
    const review = buildMonthlyReview([], [{ date: '2026-09-01', followers: 400 }], strategy, {
      now,
    });
    expect(review.followerTarget.target).toBe(10_000);
    expect(review.followerTarget.guaranteed).toBe(false);
  });
});
