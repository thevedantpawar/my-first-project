import { z } from 'zod';
import { POST_TYPES } from '../agents/linkedin-content-agent/strategy.js';
import { WORKFLOW_STATUSES } from '../validation/linkedin-content-schema.js';
import { zonedDateKey } from '../lib/timezone.js';
import { readJsonFile, writeJsonFile } from './json-store.js';

const FILE = 'runs.json';
const MAX_RUNS = 500;

export const runRecordSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  trigger: z.enum(['manual_draft', 'manual_run', 'agent_trigger', 'scheduler']),
  status: z.enum(WORKFLOW_STATUSES),
  postType: z.enum(POST_TYPES).nullable(),
  topic: z.string().default(''),
  researchSource: z.string().default(''),
  hook: z.string().default(''),
  linkedinPost: z.string().default(''),
  qualityPassed: z.boolean(),
  qualityScore: z.number(),
  qualityReasons: z.array(z.string()).default([]),
  linkedinHttpStatus: z.number().nullable().default(null),
  linkedinPostId: z.string().nullable().default(null),
  imageStatus: z.string().default('not_requested'),
  loggingStatus: z.string().default('skipped'),
  errorMessage: z.string().default(''),
});

export type RunRecord = z.infer<typeof runRecordSchema>;

export function loadRuns(): RunRecord[] {
  const parsed = z.array(runRecordSchema).safeParse(readJsonFile<unknown>(FILE, [] as unknown[]));
  return parsed.success ? parsed.data : [];
}

export function appendRun(record: RunRecord): void {
  const runs = [...loadRuns(), record];
  writeJsonFile(FILE, runs.slice(-MAX_RUNS));
}

export function lastRun(): RunRecord | null {
  const runs = loadRuns();
  return runs.length === 0 ? null : (runs[runs.length - 1] ?? null);
}

/** Topics used within the window, for duplicate-topic prevention. */
export function recentTopics(windowDays = 28, now: Date = new Date()): string[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return loadRuns()
    .filter((run) => {
      const time = Date.parse(run.timestamp);
      return Number.isFinite(time) && time >= cutoff && run.topic.trim() !== '';
    })
    .filter((run) => run.status === 'published' || run.status === 'partially_published')
    .map((run) => run.topic);
}

/**
 * The run that already published today, in the given timezone, or null.
 *
 * The portfolio allows one primary post per weekday. Checking this before any
 * provider call means a second run costs nothing — no research, no generation,
 * no quota.
 */
export function publishedToday(
  timeZone: string,
  now: Date = new Date(),
): RunRecord | null {
  const today = zonedDateKey(now, timeZone);
  const match = loadRuns()
    .filter((run) => run.status === 'published' || run.status === 'partially_published')
    .filter((run) => {
      const time = Date.parse(run.timestamp);
      return Number.isFinite(time) && zonedDateKey(new Date(time), timeZone) === today;
    });
  return match[match.length - 1] ?? null;
}
