import type { PostType, Strategy } from '../agents/linkedin-content-agent/strategy.js';
import { zonedDateKey, zonedParts } from '../lib/timezone.js';

export interface CalendarEntry {
  /** YYYY-MM-DD in the strategy timezone. */
  date: string;
  weekday: number;
  weekIndex: number;
  postType: PostType;
  focus: string;
}

const FOCUS_BY_TYPE: Record<PostType, string> = {
  'Named Problem': 'An expensive failure the buyer already feels.',
  'Deep Work System': 'The exact mechanism, architecture or checklist.',
  'Surfaced Problem/Audit': 'A diagnostic framework the buyer can apply today.',
  'Founder/Practitioner Story': 'A real event from the authenticity pack, tied to the ICP.',
  'Point-of-View': 'A category belief and the opposing belief it replaces.',
  'Lead Magnet': 'A truthful public resource, linked from the profile.',
  'Profile View Outreach': 'A post aimed at converting a profile visit.',
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Monday-Friday calendar. Weekends are never scheduled. Friday alternates
 * between the configured Friday type and the alternate so the portfolio keeps
 * a lead-magnet slot without crowding out the point of view.
 */
export function generateCalendar(
  strategy: Strategy,
  options: { weeks?: number; from?: Date } = {},
): CalendarEntry[] {
  const weeks = options.weeks ?? 4;
  const timeZone = strategy.portfolio.timezone;
  const start = options.from ?? new Date();
  const entries: CalendarEntry[] = [];

  // Walk back to the Monday of the starting week so week indexes are stable.
  const startParts = zonedParts(start, timeZone);
  let cursor = addDays(start, -(startParts.weekday - 1));

  for (let week = 0; week < weeks; week += 1) {
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(cursor, offset);
      const parts = zonedParts(day, timeZone);
      if (parts.weekday > 5) continue;
      const configured = strategy.portfolio.weekday[String(parts.weekday)];
      if (!configured) continue;
      const postType: PostType =
        parts.weekday === 5 && week % 2 === 1 ? strategy.portfolio.fridayAlternate : configured;
      entries.push({
        date: zonedDateKey(day, timeZone),
        weekday: parts.weekday,
        weekIndex: week,
        postType,
        focus: FOCUS_BY_TYPE[postType],
      });
    }
    cursor = addDays(cursor, 7);
  }

  return entries;
}

export interface MixReport {
  windowWeeks: number;
  counts: Partial<Record<PostType, number>>;
  actualPercentages: Partial<Record<PostType, number>>;
  targetPercentages: Partial<Record<PostType, number>>;
  balanced: boolean;
  warnings: string[];
}

/**
 * Checks the realised mix over the rolling window against the configured
 * target. Types with a 0% target are ignored unless they are over-used.
 */
export function evaluateMix(postTypes: PostType[], strategy: Strategy): MixReport {
  const counts: Partial<Record<PostType, number>> = {};
  for (const type of postTypes) counts[type] = (counts[type] ?? 0) + 1;

  const total = postTypes.length;
  const actualPercentages: Partial<Record<PostType, number>> = {};
  const warnings: string[] = [];
  const tolerance = strategy.portfolio.mixTolerancePercentagePoints;

  for (const [type, count] of Object.entries(counts) as [PostType, number][]) {
    actualPercentages[type] = total === 0 ? 0 : Math.round((count / total) * 100);
  }

  for (const [type, target] of Object.entries(strategy.portfolio.targetMix) as [PostType, number][]) {
    const actual = actualPercentages[type] ?? 0;
    if (Math.abs(actual - target) > tolerance) {
      warnings.push(
        `${type} is ${actual}% of the last ${total} posts; the target is ${target}% (±${tolerance}).`,
      );
    }
  }

  return {
    windowWeeks: strategy.portfolio.rollingWindowWeeks,
    counts,
    actualPercentages,
    targetPercentages: strategy.portfolio.targetMix,
    balanced: warnings.length === 0,
    warnings,
  };
}

/**
 * The post type due today, or null on a weekend. The scheduler and the manual
 * run share this so a manual run on a Wednesday still produces a Wednesday
 * format.
 */
export function postTypeForDate(strategy: Strategy, date: Date = new Date()): PostType | null {
  const timeZone = strategy.portfolio.timezone;
  const parts = zonedParts(date, timeZone);
  if (parts.weekday > 5) return null;
  const configured = strategy.portfolio.weekday[String(parts.weekday)];
  if (!configured) return null;
  if (parts.weekday !== 5) return configured;
  // ISO week parity drives the Friday alternation so it is stable across runs.
  const dayOfYear = Math.floor(
    (Date.UTC(parts.year, parts.month - 1, parts.day) - Date.UTC(parts.year, 0, 1)) /
      (24 * 60 * 60 * 1000),
  );
  const weekOfYear = Math.floor(dayOfYear / 7);
  return weekOfYear % 2 === 1 ? strategy.portfolio.fridayAlternate : configured;
}
