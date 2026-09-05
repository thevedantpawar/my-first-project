import { getConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { toSanitizedError } from '../lib/errors.js';
import { zonedMinuteKey, zonedParts } from '../lib/timezone.js';
import { runLinkedInContentWorkflow } from '../workflows/linkedin-content-workflow.js';

export const SCHEDULER_TIMEZONE = 'Asia/Kolkata';
const TICK_INTERVAL_MS = 20_000;

export interface SchedulerSettings {
  enabled: boolean;
  hour: number;
  minute: number;
  timeZone: string;
}

export interface SchedulerState {
  /** Minute key (`YYYY-MM-DDTHH:mm`, scheduler timezone) of the last execution. */
  lastRunMinuteKey: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  running: boolean;
}

export type SchedulerDecision =
  | { run: true; minuteKey: string }
  | { run: false; reason: 'disabled' | 'weekend' | 'wrong_time' | 'duplicate_minute' | 'in_progress' };

/**
 * Pure decision function: given the clock, the settings and what already ran,
 * should the workflow fire now? Monday-Friday only, never twice in one minute.
 */
export function shouldRunNow(
  now: Date,
  settings: SchedulerSettings,
  state: SchedulerState,
): SchedulerDecision {
  if (!settings.enabled) return { run: false, reason: 'disabled' };
  if (state.running) return { run: false, reason: 'in_progress' };

  const parts = zonedParts(now, settings.timeZone);
  if (parts.weekday > 5) return { run: false, reason: 'weekend' };
  if (parts.hour !== settings.hour || parts.minute !== settings.minute) {
    return { run: false, reason: 'wrong_time' };
  }

  const minuteKey = zonedMinuteKey(now, settings.timeZone);
  if (state.lastRunMinuteKey === minuteKey) return { run: false, reason: 'duplicate_minute' };

  return { run: true, minuteKey };
}

export function settingsFromConfig(): SchedulerSettings {
  const config = getConfig();
  return {
    enabled: config.SOCIAL_CONTENT_SCHEDULER_ENABLED,
    hour: config.SOCIAL_CONTENT_RUN_HOUR,
    minute: config.SOCIAL_CONTENT_RUN_MINUTE,
    timeZone: SCHEDULER_TIMEZONE,
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
    lastRunMinuteKey: null,
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

  /** Exposed for tests and for a one-shot check on startup. */
  async tick(now: Date = new Date()): Promise<SchedulerDecision> {
    const decision = shouldRunNow(now, this.settings, this.state);
    if (!decision.run) return decision;

    // Claim the minute before awaiting, so a slow run cannot be started twice.
    this.state.lastRunMinuteKey = decision.minuteKey;
    this.state.running = true;
    logger.info('Scheduled LinkedIn run starting', { minuteKey: decision.minuteKey });

    try {
      const result = await runLinkedInContentWorkflow({ trigger: 'scheduler', now });
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
