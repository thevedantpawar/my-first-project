import type { Economics, PostType, Strategy } from '../agents/linkedin-content-agent/strategy.js';
import { zonedDateKey, zonedParts } from '../lib/timezone.js';
import type { PostMetrics } from '../store/analytics.js';
import type { RunRecord } from '../store/run-log.js';
import { aggregateTotals, followerProgress } from './metrics.js';
import type { FollowerProgress } from './metrics.js';

export interface DayCell {
  date: string;
  weekday: number;
  status: 'published' | 'blocked' | 'failed' | 'none' | 'weekend' | 'future';
  postType: PostType | null;
  topic: string;
}

export interface PublishingHealth {
  weekdaysElapsed: number;
  published: number;
  blocked: number;
  failed: number;
  missed: number;
  /** Published as a share of weekdays that have passed. */
  publishRate: number | null;
  /** Drafts the gate passed first time. */
  firstPassRate: number | null;
  /** Days a single revision rescued from publishing nothing. */
  revisionRescues: number;
  currentStreak: number;
}

export interface FunnelStep {
  label: string;
  value: number | null;
  /** Conversion from the previous step, when both are known. */
  rateFromPrevious: number | null;
  note: string;
}

export interface PipelineProjection {
  configured: boolean;
  /** Rates actually observed, where enough data exists to compute them. */
  usingRecordedRates: boolean;
  qualifiedConversationsPerMonth: number | null;
  projectedCallsPerMonth: number | null;
  projectedDealsPerMonth: number | null;
  projectedRevenuePerMonth: number | null;
  projectedGrossProfitPerMonth: number | null;
  recordedRevenueToDate: number | null;
  assumptions: string[];
  caveat: string;
}

export interface Overview {
  generatedAt: string;
  schedule: {
    enabled: boolean;
    dryRun: boolean;
    timeZone: string;
    scheduledTime: string;
    nextRunAt: string | null;
    secondsUntilNextRun: number | null;
  };
  calendar: DayCell[];
  publishing: PublishingHealth;
  followers: FollowerProgress & {
    gapToTarget: number | null;
    weeksRemaining: number;
    neededPerWeek: number | null;
  };
  funnel: FunnelStep[];
  pipeline: PipelineProjection;
  formulaUsage: { id: string; name: string; uses: number }[];
  recentRuns: RunRecord[];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function statusOf(run: RunRecord | undefined): DayCell['status'] {
  if (!run) return 'none';
  if (run.status === 'published' || run.status === 'partially_published') return 'published';
  if (run.status === 'quality_blocked') return 'blocked';
  return 'failed';
}

/** The last `days` calendar days, newest last, with what happened on each. */
function buildCalendar(runs: RunRecord[], timeZone: string, now: Date, days: number): DayCell[] {
  const byDate = new Map<string, RunRecord>();
  for (const run of runs) {
    const time = Date.parse(run.timestamp);
    if (!Number.isFinite(time)) continue;
    const key = zonedDateKey(new Date(time), timeZone);
    // Keep the most consequential outcome for the day.
    const existing = byDate.get(key);
    if (!existing || statusOf(run) === 'published') byDate.set(key, run);
  }

  const cells: DayCell[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(now.getTime() - back * 24 * 60 * 60 * 1000);
    const key = zonedDateKey(day, timeZone);
    const parts = zonedParts(day, timeZone);
    const run = byDate.get(key);
    cells.push({
      date: key,
      weekday: parts.weekday,
      status: parts.weekday > 5 && !run ? 'weekend' : statusOf(run),
      postType: run?.postType ?? null,
      topic: run?.topic ?? '',
    });
  }
  return cells;
}

function buildPublishingHealth(runs: RunRecord[], calendar: DayCell[]): PublishingHealth {
  const weekdayCells = calendar.filter((cell) => cell.weekday <= 5);
  const published = weekdayCells.filter((cell) => cell.status === 'published').length;
  const blocked = weekdayCells.filter((cell) => cell.status === 'blocked').length;
  const failed = weekdayCells.filter((cell) => cell.status === 'failed').length;
  const missed = weekdayCells.filter((cell) => cell.status === 'none').length;

  let currentStreak = 0;
  for (let index = weekdayCells.length - 1; index >= 0; index -= 1) {
    if (weekdayCells[index]?.status === 'published') currentStreak += 1;
    else break;
  }

  // A run that needed a revision still counts as a first-pass miss.
  const gated = runs.filter((run) => run.status !== 'failed');
  const firstPass = gated.filter((run) => run.qualityPassed && run.qualityReasons.length === 0);

  return {
    weekdaysElapsed: weekdayCells.length,
    published,
    blocked,
    failed,
    missed,
    publishRate: rate(published, weekdayCells.length),
    firstPassRate: rate(firstPass.length, gated.length),
    revisionRescues: runs.filter((run) => run.revisionRescued).length,
    currentStreak,
  };
}

function buildFunnel(posts: PostMetrics[]): FunnelStep[] {
  const totals = aggregateTotals(posts);
  const steps: { label: string; value: number | null; note: string }[] = [
    { label: 'Impressions', value: totals.impressions, note: 'From post analytics.' },
    {
      label: 'Profile views',
      value: totals.profileViews,
      note: 'Where a reader decides whether you are worth following.',
    },
    {
      label: 'Link clicks',
      value: totals.linkClicks,
      note: 'Only non-zero once a CTA points somewhere.',
    },
    {
      label: 'Qualified conversations',
      value: totals.qualifiedConversations,
      note: 'A real reply from someone in the ICP. Your judgement, entered by hand.',
    },
    { label: 'Booked calls', value: totals.bookedCalls, note: 'Traceable to a post.' },
  ];

  return steps.map((step, index) => {
    const previous = index === 0 ? null : (steps[index - 1]?.value ?? null);
    return {
      ...step,
      rateFromPrevious:
        previous === null || step.value === null || previous === 0 ? null : step.value / previous,
    };
  });
}

/**
 * Projects pipeline from recorded activity.
 *
 * Follower count is not an input, because it does not predict revenue: 1,000
 * of the wrong people is worth nothing and 200 of the right ones can be worth a
 * great deal. The chain that does predict it is conversations -> calls -> deals,
 * and every rate here is either measured from the operator's own entries or
 * flagged as an assumption they set.
 */
export function projectPipeline(
  posts: PostMetrics[],
  economics: Economics,
  now: Date,
): PipelineProjection {
  const totals = aggregateTotals(posts);
  const caveat =
    'A projection from your own recorded numbers, not a forecast. It is only as good as what you enter, and it says nothing about months you have not had yet.';

  if (economics.averageDealValueUsd <= 0) {
    return {
      configured: false,
      usingRecordedRates: false,
      qualifiedConversationsPerMonth: null,
      projectedCallsPerMonth: null,
      projectedDealsPerMonth: null,
      projectedRevenuePerMonth: null,
      projectedGrossProfitPerMonth: null,
      recordedRevenueToDate: totals.attributedRevenue,
      assumptions: [
        'averageDealValueUsd is 0 in config/strategy/economics.json, so there is nothing to project. Set it to your typical first engagement.',
      ],
      caveat,
    };
  }

  const dated = posts
    .map((post) => Date.parse(post.publishedAt))
    .filter((time) => Number.isFinite(time));
  const earliest = dated.length > 0 ? Math.min(...dated) : now.getTime();
  const months = Math.max((now.getTime() - earliest) / (30 * 24 * 60 * 60 * 1000), 1 / 30);

  const conversations = totals.qualifiedConversations;
  const conversationsPerMonth = conversations === null ? null : conversations / months;

  // Prefer rates the operator has actually observed over the configured guesses.
  const observedCallRate =
    conversations !== null && conversations > 0 && totals.bookedCalls !== null
      ? totals.bookedCalls / conversations
      : null;
  const callRate = observedCallRate ?? economics.conversationToCallRate;
  const usingRecordedRates = observedCallRate !== null;

  const callsPerMonth = conversationsPerMonth === null ? null : conversationsPerMonth * callRate;
  const dealsPerMonth = callsPerMonth === null ? null : callsPerMonth * economics.callToDealRate;
  const revenuePerMonth =
    dealsPerMonth === null ? null : dealsPerMonth * economics.averageDealValueUsd;

  const assumptions: string[] = [
    `Average deal value $${economics.averageDealValueUsd.toLocaleString()}.`,
    usingRecordedRates
      ? `Conversation to call ${(callRate * 100).toFixed(0)}%, measured from your entries.`
      : `Conversation to call ${(callRate * 100).toFixed(0)}%, an assumption you set — no recorded calls yet.`,
    `Call to deal ${(economics.callToDealRate * 100).toFixed(0)}%, an assumption you set.`,
    `Gross margin ${economics.grossMarginPercent}%.`,
  ];
  if (conversations === null) {
    assumptions.push(
      'No qualified conversations recorded, so the chain has no starting number. Enter them in the Metrics tab.',
    );
  }

  return {
    configured: true,
    usingRecordedRates,
    qualifiedConversationsPerMonth: conversationsPerMonth,
    projectedCallsPerMonth: callsPerMonth,
    projectedDealsPerMonth: dealsPerMonth,
    projectedRevenuePerMonth: revenuePerMonth,
    projectedGrossProfitPerMonth:
      revenuePerMonth === null ? null : revenuePerMonth * (economics.grossMarginPercent / 100),
    recordedRevenueToDate: totals.attributedRevenue,
    assumptions,
    caveat,
  };
}

export function buildOverview(input: {
  runs: RunRecord[];
  posts: PostMetrics[];
  followerSamples: { date: string; followers: number }[];
  strategy: Strategy;
  schedule: Overview['schedule'];
  now?: Date;
}): Overview {
  const now = input.now ?? new Date();
  const timeZone = input.strategy.portfolio.timezone;
  const calendar = buildCalendar(input.runs, timeZone, now, 28);

  const target = input.strategy.audience.growthTarget;
  const progress = followerProgress(input.followerSamples, target.followers, target.months, now);

  const deadline = target.deadline ? Date.parse(target.deadline) : Number.NaN;
  const weeksRemaining = Number.isFinite(deadline)
    ? Math.max(Math.ceil((deadline - now.getTime()) / (7 * 24 * 60 * 60 * 1000)), 0)
    : 0;
  const gapToTarget = progress.current === null ? null : Math.max(target.followers - progress.current, 0);

  const usage = new Map<string, number>();
  for (const run of input.runs) {
    const id = run.hookFormulaId ?? '';
    if (id !== '') usage.set(id, (usage.get(id) ?? 0) + 1);
  }

  return {
    generatedAt: now.toISOString(),
    schedule: input.schedule,
    calendar,
    publishing: buildPublishingHealth(input.runs, calendar),
    followers: {
      ...progress,
      gapToTarget,
      weeksRemaining,
      neededPerWeek:
        gapToTarget === null || weeksRemaining === 0 ? null : Math.ceil(gapToTarget / weeksRemaining),
    },
    funnel: buildFunnel(input.posts),
    pipeline: projectPipeline(input.posts, input.strategy.economics, now),
    formulaUsage: input.strategy.hookFormulas
      .map((formula) => ({ id: formula.id, name: formula.name, uses: usage.get(formula.id) ?? 0 }))
      .filter((entry) => entry.uses > 0)
      .sort((a, b) => b.uses - a.uses),
    recentRuns: input.runs.slice(-20).reverse(),
  };
}
