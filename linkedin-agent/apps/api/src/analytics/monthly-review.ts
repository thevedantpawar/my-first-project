import type { PostType, Strategy } from '../agents/linkedin-content-agent/strategy.js';
import { evaluateMix } from '../calendar/content-calendar.js';
import type { MixReport } from '../calendar/content-calendar.js';
import type { PostMetrics } from '../store/analytics.js';
import {
  aggregateTotals,
  computePostRates,
  followerProgress,
  rankByAudienceRelevance,
  rankByBusinessOutcome,
  rankByDistribution,
} from './metrics.js';
import type { AggregateTotals, FollowerProgress, PostRates } from './metrics.js';

export interface RankedPost {
  postId: string;
  postType: PostType;
  topic: string;
  hook: string;
  rates: PostRates;
}

export interface MonthlyReview {
  windowDays: number;
  generatedAt: string;
  postsAnalyzed: number;
  totals: AggregateTotals;
  byBusinessOutcome: RankedPost[];
  byAudienceRelevance: RankedPost[];
  byDistribution: RankedPost[];
  winning: {
    hooks: string[];
    postTypes: { postType: PostType; posts: number; qualifiedActions: number }[];
    topics: string[];
    ctaTypes: string[];
    visualPattern: 'image' | 'text_only' | 'inconclusive';
  };
  mix: MixReport;
  followerTarget: FollowerProgress;
  recommendations: string[];
}

function toRanked(post: PostMetrics): RankedPost {
  return {
    postId: post.postId,
    postType: post.postType,
    topic: post.topic,
    hook: post.hook,
    rates: computePostRates(post),
  };
}

function qualifiedActions(post: PostMetrics): number {
  return (post.saves ?? 0) + (post.profileViews ?? 0) + (post.linkClicks ?? 0) + (post.bookedCalls ?? 0) * 10;
}

/**
 * The 30-day learning loop. Ranks by business outcome first and audience
 * relevance second; distribution is informative but never the headline.
 */
export function buildMonthlyReview(
  posts: PostMetrics[],
  followerSamples: { date: string; followers: number }[],
  strategy: Strategy,
  options: { windowDays?: number; now?: Date } = {},
): MonthlyReview {
  const windowDays = options.windowDays ?? 30;
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const inWindow = posts.filter((post) => {
    const time = Date.parse(post.publishedAt);
    return Number.isFinite(time) && time >= cutoff;
  });

  const byOutcome = rankByBusinessOutcome(inWindow).map(toRanked);
  const byRelevance = rankByAudienceRelevance(inWindow).map(toRanked);
  const byDistribution = rankByDistribution(inWindow).map(toRanked);

  const typeTotals = new Map<PostType, { posts: number; qualifiedActions: number }>();
  for (const post of inWindow) {
    const current = typeTotals.get(post.postType) ?? { posts: 0, qualifiedActions: 0 };
    typeTotals.set(post.postType, {
      posts: current.posts + 1,
      qualifiedActions: current.qualifiedActions + qualifiedActions(post),
    });
  }
  const postTypeRanking = [...typeTotals.entries()]
    .map(([postType, totals]) => ({ postType, ...totals }))
    .sort((a, b) => b.qualifiedActions - a.qualifiedActions);

  const ctaTotals = new Map<string, number>();
  for (const post of inWindow) {
    ctaTotals.set(post.ctaType, (ctaTotals.get(post.ctaType) ?? 0) + qualifiedActions(post));
  }

  const withImage = inWindow.filter((post) => post.hadImage);
  const withoutImage = inWindow.filter((post) => !post.hadImage);
  const averageQualified = (list: PostMetrics[]): number =>
    list.length === 0 ? 0 : list.reduce((sum, post) => sum + qualifiedActions(post), 0) / list.length;
  const visualPattern: 'image' | 'text_only' | 'inconclusive' =
    withImage.length < 2 || withoutImage.length < 2
      ? 'inconclusive'
      : averageQualified(withImage) > averageQualified(withoutImage)
        ? 'image'
        : 'text_only';

  const mix = evaluateMix(
    inWindow.map((post) => post.postType),
    strategy,
  );

  const progress = followerProgress(
    followerSamples,
    strategy.audience.growthTarget.followers,
    strategy.audience.growthTarget.months,
    now,
  );

  const recommendations = buildRecommendations({
    inWindow,
    postTypeRanking,
    mix,
    progress,
    visualPattern,
    byOutcome,
  });

  return {
    windowDays,
    generatedAt: now.toISOString(),
    postsAnalyzed: inWindow.length,
    totals: aggregateTotals(inWindow),
    byBusinessOutcome: byOutcome.slice(0, 10),
    byAudienceRelevance: byRelevance.slice(0, 10),
    byDistribution: byDistribution.slice(0, 10),
    winning: {
      hooks: byOutcome.slice(0, 5).map((post) => post.hook).filter((hook) => hook !== ''),
      postTypes: postTypeRanking,
      topics: byRelevance.slice(0, 5).map((post) => post.topic).filter((topic) => topic !== ''),
      ctaTypes: [...ctaTotals.entries()].sort((a, b) => b[1] - a[1]).map(([cta]) => cta),
      visualPattern,
    },
    mix,
    followerTarget: progress,
    recommendations,
  };
}

function buildRecommendations(input: {
  inWindow: PostMetrics[];
  postTypeRanking: { postType: PostType; posts: number; qualifiedActions: number }[];
  mix: MixReport;
  progress: FollowerProgress;
  visualPattern: 'image' | 'text_only' | 'inconclusive';
  byOutcome: RankedPost[];
}): string[] {
  const recommendations: string[] = [];

  if (input.inWindow.length === 0) {
    return [
      'No metrics recorded in this window. Enter per-post numbers before drawing any conclusion — the review is only as honest as its inputs.',
    ];
  }

  if (input.inWindow.length < 8) {
    recommendations.push(
      `Only ${input.inWindow.length} posts have metrics. Treat every pattern below as a hypothesis, not a finding.`,
    );
  }

  const best = input.postTypeRanking[0];
  const worst = input.postTypeRanking[input.postTypeRanking.length - 1];
  if (best && best.posts >= 2) {
    recommendations.push(
      `"${best.postType}" produced the most qualified action (${best.qualifiedActions} across ${best.posts} posts). Give it one extra slot next month.`,
    );
  }
  if (worst && worst !== best && worst.posts >= 2 && worst.qualifiedActions === 0) {
    recommendations.push(
      `"${worst.postType}" produced no qualified action across ${worst.posts} posts. Change the angle or drop the format.`,
    );
  }

  const noBusinessOutcome = input.inWindow.filter(
    (post) => (post.bookedCalls ?? 0) === 0 && (post.qualifiedConversations ?? 0) === 0,
  );
  const highReachNoAction = noBusinessOutcome.filter((post) => (post.impressions ?? 0) > 5000);
  if (highReachNoAction.length >= 2) {
    recommendations.push(
      `${highReachNoAction.length} posts cleared 5,000 impressions with no qualified conversation. Reach is landing on the wrong audience — tighten the buyer situation in the hook.`,
    );
  }

  if (input.visualPattern !== 'inconclusive') {
    recommendations.push(
      input.visualPattern === 'image'
        ? 'Posts with a value-dense image outperformed text-only ones. Keep building diagrams.'
        : 'Text-only posts outperformed the illustrated ones. The images are decorating, not explaining — cut them or make them denser.',
    );
  }

  recommendations.push(...input.mix.warnings.map((warning) => `Portfolio balance: ${warning}`));

  recommendations.push(
    input.progress.pacing === 'behind'
      ? 'Follower pacing is behind the working target. Publishing consistency and hook specificity are the two levers; the number is never guaranteed.'
      : input.progress.pacing === 'ahead'
        ? 'Follower pacing is ahead of the working target. Check that the new audience is the ICP before celebrating it.'
        : 'Follower pacing is roughly on the working target. Keep judging by qualified conversations, not the count.',
  );

  const topHook = input.byOutcome[0]?.hook;
  if (topHook) {
    recommendations.push(
      `Best-performing hook this window: "${topHook}". Reuse the pattern with genuinely new evidence, not the same sentence.`,
    );
  }

  return recommendations;
}
