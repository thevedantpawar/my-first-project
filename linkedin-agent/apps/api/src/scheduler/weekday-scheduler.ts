import { getConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { toSanitizedError } from '../lib/errors.js';
import { zonedDateKey, zonedMinuteKey, zonedParts } from '../lib/timezone.js';
import { schedulerRanToday } from '../store/run-log.js';
import { runLinkedInContentWorkflow } from '../workflows/linkedin-content-workflow.js';

export const SCHEDULER_TIMEZONE = 'Asia/Kolkata';
const TICK_INTERVAL_MS = 20_000;

/**
 * How long after the scheduled time a run may still start.
 *
 * Firing only on the exact minute means a redeploy or a restart spanning 21:00
 * loses that weekday's post with nothing in the logs to explain it. Within this
 * window the run is simply late; after it, the day is skipped rather than
 * posting at a time the audience is not expecting.
 */
export const DEFAULT_GRACE_MINUTES = 60;

export interface SchedulerSettings {
  enabled: boolean;
  hour: number;
  minute: number;
  timeZone: string;
  /** Minutes after the scheduled time during which a late run may still start. */
  graceMinutes: number;
}

export interface SchedulerState {
  /** Date key (`YYYY-MM-DD`, scheduler timezone) of the last execution. */
  lastRunDateKey: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  running: boolean;
}

export type SchedulerSkipReason =
  | 'disabled'
  | 'weekend'
  | 'before_window'
  | 'window_passed'
  | 'already_ran_today'
  | 'in_progress';

export type SchedulerDecision =
  | { run: true; dateKey: string; minuteKey: string; minutesLate: number }
  | { run: false; reason: SchedulerSkipReason };

/**
 * Pure decision function: Monday-Friday, at or shortly after the scheduled
 * time, at most once per day.
 *
 * `alreadyRanToday` comes from the persisted run log, so the once-a-day
 * guarantee survives a restart instead of living only in this process.
 */
export function shouldRunNow(
  now: Date,
  settings: SchedulerSettings,
  state: SchedulerState,
  alreadyRanToday = false,
): SchedulerDecision {
  if (!settings.enabled) return { run: false, reason: 'disabled' };
  if (state.running) return { run: false, reason: 'in_progress' };

  const parts = zonedParts(now, settings.timeZone);
  if (parts.weekday > 5) return { run: false, reason: 'weekend' };

  const minutesLate =
    parts.hour * 60 + parts.minute - (settings.hour * 60 + settings.minute);
  if (minutesLate < 0) return { run: false, reason: 'before_window' };
  if (minutesLate >= settings.graceMinutes) return { run: false, reason: 'window_passed' };

  const dateKey = zonedDateKey(now, settings.timeZone);
  if (alreadyRanToday || state.lastRunDateKey === dateKey) {
    return { run: false, reason: 'already_ran_today' };
  }

  return { run: true, dateKey, minuteKey: zonedMinuteKey(now, settings.timeZone), minutesLate };
}

export function settingsFromConfig(): SchedulerSettings {
  const config = getConfig();
  return {
    enabled: config.SOCIAL_CONTENT_SCHEDULER_ENABLED,
    hour: config.SOCIAL_CONTENT_RUN_HOUR,
    minute: config.SOCIAL_CONTENT_RUN_MINUTE,
    timeZone: SCHEDULER_TIMEZONE,
    graceMinutes: DEFAULT_GRACE_MINUTES,
  };
}

/** Minutes that the zone is ahead of UTC at this instant. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/** Next Monday-Friday occurrence of the configured time, as an ISO instant. */
export function nextRunAt(settings: SchedulerSettings, from: Date = new Date()): string | null {
  if (!settings.enabled) return null;
  const offset = zoneOffsetMinutes(from, settings.timeZone);
  const local = zonedParts(from, settings.timeZone);

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const wallClock = Date.UTC(
      local.year,
      local.month - 1,
      local.day + dayOffset,
      settings.hour,
      settings.minute,
    );
    const candidate = new Date(wallClock - offset * 60_000);
    if (candidate.getTime() <= from.getTime()) continue;
    // Re-read the candidate in the target zone: this corrects the offset guess
    // in zones that observe DST, and filters weekends.
    const parts = zonedParts(candidate, settings.timeZone);
    if (parts.weekday > 5) continue;
    if (parts.hour !== settings.hour || parts.minute !== settings.minute) continue;
    return candidate.toISOString();
  }
  return null;
}

export class WeekdayScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly state: SchedulerState = {
    lastRunDateKey: null,
    lastRunAt: null,
    lastRunStatus: null,
    running: false,
  };

  constructor(private readonly settings: SchedulerSettings = settingsFromConfig()) {}

  start(): void {
    if (!this.settings.enabled) {
      logger.info('Scheduler disabled', {
        reason: 'SOCIAL_CONTENT_SCHEDULER_ENABLED is not true',
      });
      return;
    }
    if (this.timer) return;
    logger.info('Scheduler started', {
      timeZone: this.settings.timeZone,
      hour: this.settings.hour,
      minute: this.settings.minute,
      days: 'Mon-Fri',
      nextRunAt: nextRunAt(this.settings),
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Scheduler stopped');
    }
  }

  getState(): SchedulerState {
    return { ...this.state };
  }

  getSettings(): SchedulerSettings {
    return { ...this.settings };
  }

  /**
   * Exposed for tests and for a one-shot check on startup. `fetchImpl` is a
   * test seam, matching every provider in this codebase.
   */
  async tick(now: Date = new Date(), fetchImpl?: typeof fetch): Promise<SchedulerDecision> {
    let alreadyRanToday = false;
    try {
      alreadyRanToday = schedulerRanToday(this.settings.timeZone, now) !== null;
    } catch (error) {
      // A missing or unreadable run log must not wedge the scheduler; the
      // in-memory date key still prevents a same-process double run.
      logger.warn('Could not read the run log for today', {
        msg: toSanitizedError(error).message,
      });
    }

    const decision = shouldRunNow(now, this.settings, this.state, alreadyRanToday);
    if (!decision.run) return decision;

    // Claim the day before awaiting, so a slow run cannot be started twice.
    this.state.lastRunDateKey = decision.dateKey;
    this.state.running = true;
    logger.info('Scheduled LinkedIn run starting', {
      dateKey: decision.dateKey,
      minutesLate: decision.minutesLate,
      late: decision.minutesLate > 0,
    });

    try {
      const result = await runLinkedInContentWorkflow({
        trigger: 'scheduler',
        now,
        ...(fetchImpl ? { fetchImpl } : {}),
      });
      this.state.lastRunAt = result.timestamp;
      this.state.lastRunStatus = result.status;
      logger.info('Scheduled LinkedIn run finished', {
        status: result.status,
        qualityPassed: result.qualityPassed,
      });
    } catch (error) {
      const sanitized = toSanitizedError(error);
      this.state.lastRunAt = now.toISOString();
      this.state.lastRunStatus = 'failed';
      logger.error('Scheduled LinkedIn run threw', {
        code: sanitized.code,
        msg: sanitized.message,
      });
    } finally {
      this.state.running = false;
    }

    return decision;
  }
}
