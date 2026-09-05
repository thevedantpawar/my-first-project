import type { PostMetrics } from '../store/analytics.js';

export interface PostRates {
  postId: string;
  /** (reactions + comments + reposts) / impressions */
  engagementRate: number | null;
  /** reposts / impressions */
  repostRate: number | null;
  /** profileViews / impressions */
  profileConversionRate: number | null;
  /** (saves + profileViews + linkClicks) / impressions */
  qualifiedActionRate: number | null;
  /** bookedCalls / qualifiedConversations */
  leadConversionRate: number | null;
  /** attributedRevenue - cost; null when revenue is unknown */
  profitPerPost: number | null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
}

/**
 * Rates are null, never zero, when the underlying number was never recorded.
 * A missing metric must not read as a bad result.
 */
export function computePostRates(post: PostMetrics): PostRates {
  const engagementNumerator = sumOrNull([post.reactions, post.comments, post.reposts]);
  const qualifiedNumerator = sumOrNull([post.saves, post.profileViews, post.linkClicks]);
  return {
    postId: post.postId,
    engagementRate: ratio(engagementNumerator, post.impressions),
    repostRate: ratio(post.reposts, post.impressions),
    profileConversionRate: ratio(post.profileViews, post.impressions),
    qualifiedActionRate: ratio(qualifiedNumerator, post.impressions),
    leadConversionRate: ratio(post.bookedCalls, post.qualifiedConversations),
    profitPerPost:
      post.attributedRevenue === null ? null : post.attributedRevenue - (post.cost ?? 0),
  };
}

export interface AggregateTotals {
  posts: number;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  profileViews: number | null;
  linkClicks: number | null;
  emailSignups: number | null;
  qualifiedConversations: number | null;
  bookedCalls: number | null;
  attributedRevenue: number | null;
}

export function aggregateTotals(posts: PostMetrics[]): AggregateTotals {
  return {
    posts: posts.length,
    impressions: sumOrNull(posts.map((post) => post.impressions)),
    reactions: sumOrNull(posts.map((post) => post.reactions)),
    comments: sumOrNull(posts.map((post) => post.comments)),
    reposts: sumOrNull(posts.map((post) => post.reposts)),
    saves: sumOrNull(posts.map((post) => post.saves)),
    profileViews: sumOrNull(posts.map((post) => post.profileViews)),
    linkClicks: sumOrNull(posts.map((post) => post.linkClicks)),
    emailSignups: sumOrNull(posts.map((post) => post.emailSignups)),
    qualifiedConversations: sumOrNull(posts.map((post) => post.qualifiedConversations)),
    bookedCalls: sumOrNull(posts.map((post) => post.bookedCalls)),
    attributedRevenue: sumOrNull(posts.map((post) => post.attributedRevenue)),
  };
}

/**
 * Business outcome first: booked calls, then qualified conversations, then
 * revenue, then saves/profile views. Impressions are the last tiebreaker on
 * purpose — the wrong audience at scale is not a win.
 */
export function rankByBusinessOutcome(posts: PostMetrics[]): PostMetrics[] {
  const score = (post: PostMetrics): number =>
    (post.bookedCalls ?? 0) * 1000 +
    (post.qualifiedConversations ?? 0) * 200 +
    (post.emailSignups ?? 0) * 50 +
    (post.attributedRevenue ?? 0) / 100;
  return [...posts].sort((a, b) => score(b) - score(a));
}

export function rankByAudienceRelevance(posts: PostMetrics[]): PostMetrics[] {
  const score = (post: PostMetrics): number => {
    const rates = computePostRates(post);
    return (rates.qualifiedActionRate ?? 0) * 1000 + (rates.profileConversionRate ?? 0) * 500;
  };
  return [...posts].sort((a, b) => score(b) - score(a));
}

export function rankByDistribution(posts: PostMetrics[]): PostMetrics[] {
  const score = (post: PostMetrics): number => {
    const rates = computePostRates(post);
    return (rates.repostRate ?? 0) * 1000 + (rates.engagementRate ?? 0) * 100;
  };
  return [...posts].sort((a, b) => score(b) - score(a));
}

export type TargetPacing = 'ahead' | 'on_track' | 'behind' | 'unknown';

export interface FollowerProgress {
  target: number;
  months: number;
  current: number | null;
  baseline: number | null;
  expectedByNow: number | null;
  pacing: TargetPacing;
  /** Always false. The system never guarantees a follower count. */
  guaranteed: false;
  note: string;
}

/**
 * Straight-line pacing against the target. Reports ahead/on track/behind and
 * never presents the target as a promise.
 */
export function followerProgress(
  samples: { date: string; followers: number }[],
  target: number,
  months: number,
  now: Date = new Date(),
): FollowerProgress {
  const sorted = [...samples].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const note =
    'Follower count is a directional target, not a guarantee. Qualified conversations and booked calls decide whether this is working.';

  if (!first || !last) {
    return {
      target,
      months,
      current: null,
      baseline: null,
      expectedByNow: null,
      pacing: 'unknown',
      guaranteed: false,
      note: `${note} No follower samples recorded yet.`,
    };
  }

  const start = Date.parse(first.date);
  const elapsedDays = (now.getTime() - start) / (24 * 60 * 60 * 1000);
  const totalDays = months * 30;
  if (!Number.isFinite(start) || elapsedDays <= 0) {
    return {
      target,
      months,
      current: last.followers,
      baseline: first.followers,
      expectedByNow: null,
      pacing: 'unknown',
      guaranteed: false,
      note,
    };
  }

  const progressShare = Math.min(elapsedDays / totalDays, 1);
  const expectedByNow = first.followers + (target - first.followers) * progressShare;
  const delta = last.followers - expectedByNow;
  const tolerance = Math.max(expectedByNow * 0.1, 50);
  const pacing: TargetPacing =
    delta > tolerance ? 'ahead' : delta < -tolerance ? 'behind' : 'on_track';

  return {
    target,
    months,
    current: last.followers,
    baseline: first.followers,
    expectedByNow: Math.round(expectedByNow),
    pacing,
    guaranteed: false,
    note,
  };
}
