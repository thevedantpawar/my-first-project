import { z } from 'zod';
import { POST_TYPES, CTA_TYPES } from '../agents/linkedin-content-agent/strategy.js';
import { readJsonFile, writeJsonFile } from './json-store.js';

const FILE = 'analytics.json';

/**
 * Per-post metrics. Everything is optional because LinkedIn does not expose
 * saves or per-post profile views to this API — those are entered by hand and
 * left null when unknown rather than estimated.
 */
export const postMetricsSchema = z.object({
  postId: z.string().min(1),
  publishedAt: z.string().min(1),
  postType: z.enum(POST_TYPES),
  topic: z.string().default(''),
  hook: z.string().default(''),
  ctaType: z.enum(CTA_TYPES),
  pointOfView: z.string().default(''),
  hadImage: z.boolean().default(false),
  impressions: z.number().nonnegative().nullable().default(null),
  reactions: z.number().nonnegative().nullable().default(null),
  comments: z.number().nonnegative().nullable().default(null),
  reposts: z.number().nonnegative().nullable().default(null),
  saves: z.number().nonnegative().nullable().default(null),
  profileViews: z.number().nonnegative().nullable().default(null),
  linkClicks: z.number().nonnegative().nullable().default(null),
  emailSignups: z.number().nonnegative().nullable().default(null),
  qualifiedConversations: z.number().nonnegative().nullable().default(null),
  bookedCalls: z.number().nonnegative().nullable().default(null),
  attributedRevenue: z.number().nullable().default(null),
  cost: z.number().nonnegative().nullable().default(null),
  notes: z.string().default(''),
});

export type PostMetrics = z.infer<typeof postMetricsSchema>;

export const followerSampleSchema = z.object({
  date: z.string().min(1),
  followers: z.number().nonnegative(),
  note: z.string().default(''),
});

export type FollowerSample = z.infer<typeof followerSampleSchema>;

export const analyticsStoreSchema = z.object({
  posts: z.array(postMetricsSchema).default([]),
  followerSamples: z.array(followerSampleSchema).default([]),
});

export type AnalyticsStore = z.infer<typeof analyticsStoreSchema>;

const EMPTY: AnalyticsStore = { posts: [], followerSamples: [] };

export function loadAnalytics(): AnalyticsStore {
  const parsed = analyticsStoreSchema.safeParse(readJsonFile<unknown>(FILE, EMPTY));
  return parsed.success ? parsed.data : EMPTY;
}

export function saveAnalytics(store: AnalyticsStore): void {
  writeJsonFile(FILE, store);
}

/** Upserts by postId so a metrics refresh does not duplicate rows. */
export function upsertPostMetrics(metrics: PostMetrics): AnalyticsStore {
  const store = loadAnalytics();
  const index = store.posts.findIndex((post) => post.postId === metrics.postId);
  const posts = [...store.posts];
  if (index >= 0) posts[index] = { ...posts[index], ...metrics };
  else posts.push(metrics);
  const next: AnalyticsStore = { ...store, posts };
  saveAnalytics(next);
  return next;
}

export function recordFollowerSample(sample: FollowerSample): AnalyticsStore {
  const store = loadAnalytics();
  const next: AnalyticsStore = {
    ...store,
    followerSamples: [...store.followerSamples, sample].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
  };
  saveAnalytics(next);
  return next;
}
