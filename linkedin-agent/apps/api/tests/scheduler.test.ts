import { describe, expect, it } from 'vitest';
import {
  SCHEDULER_TIMEZONE,
  nextRunAt,
  shouldRunNow,
} from '../src/scheduler/weekday-scheduler.js';
import type { SchedulerSettings, SchedulerState } from '../src/scheduler/weekday-scheduler.js';
import { zonedMinuteKey, zonedParts } from '../src/lib/timezone.js';

const settings: SchedulerSettings = {
  enabled: true,
  hour: 21,
  minute: 0,
  timeZone: SCHEDULER_TIMEZONE,
};

function freshState(): SchedulerState {
  return { lastRunMinuteKey: null, lastRunAt: null, lastRunStatus: null, running: false };
}

/** 21:00 Asia/Kolkata is 15:30 UTC (IST is UTC+5:30, with no DST). */
function istNinePm(isoDate: string): Date {
  return new Date(`${isoDate}T15:30:00.000Z`);
}

describe('timezone helpers', () => {
  it('reads 15:30 UTC as 21:00 in Asia/Kolkata', () => {
    const parts = zonedParts(istNinePm('2026-09-07'), SCHEDULER_TIMEZONE);
    expect(parts.hour).toBe(21);
    expect(parts.minute).toBe(0);
    expect(parts.weekday).toBe(1);
  });
});

describe('Monday to Friday execution', () => {
  const weekdays: [string, string, number][] = [
    ['Monday', '2026-09-07', 1],
    ['Tuesday', '2026-09-08', 2],
    ['Wednesday', '2026-09-09', 3],
    ['Thursday', '2026-09-10', 4],
    ['Friday', '2026-09-11', 5],
  ];

  for (const [label, date, weekday] of weekdays) {
    it(`runs on ${label} at 21:00 IST`, () => {
      const now = istNinePm(date);
      expect(zonedParts(now, SCHEDULER_TIMEZONE).weekday).toBe(weekday);
      const decision = shouldRunNow(now, settings, freshState());
      expect(decision.run).toBe(true);
    });
  }
});

describe('weekend exclusion', () => {
  for (const [label, date] of [
    ['Saturday', '2026-09-12'],
    ['Sunday', '2026-09-13'],
  ] as [string, string][]) {
    it(`never runs on ${label}`, () => {
      const decision = shouldRunNow(istNinePm(date), settings, freshState());
      expect(decision).toEqual({ run: false, reason: 'weekend' });
    });
  }
});

describe('time and enablement gates', () => {
  it('does not run outside the configured minute', () => {
    const now = new Date('2026-09-07T15:31:00.000Z');
    expect(shouldRunNow(now, settings, freshState())).toEqual({ run: false, reason: 'wrong_time' });
  });

  it('does not run when disabled', () => {
    const decision = shouldRunNow(
      istNinePm('2026-09-07'),
      { ...settings, enabled: false },
      freshState(),
    );
    expect(decision).toEqual({ run: false, reason: 'disabled' });
  });

  it('honours a custom hour and minute', () => {
    const custom = { ...settings, hour: 9, minute: 30 };
    // 09:30 IST is 04:00 UTC.
    const decision = shouldRunNow(new Date('2026-09-07T04:00:00.000Z'), custom, freshState());
    expect(decision.run).toBe(true);
  });
});

describe('duplicate execution prevention', () => {
  it('refuses a second run inside the same minute', () => {
    const now = istNinePm('2026-09-07');
    const minuteKey = zonedMinuteKey(now, SCHEDULER_TIMEZONE);
    const state: SchedulerState = { ...freshState(), lastRunMinuteKey: minuteKey };
    expect(shouldRunNow(now, settings, state)).toEqual({ run: false, reason: 'duplicate_minute' });
  });

  it('allows the next weekday once the minute has changed', () => {
    const monday = istNinePm('2026-09-07');
    const state: SchedulerState = {
      ...freshState(),
      lastRunMinuteKey: zonedMinuteKey(monday, SCHEDULER_TIMEZONE),
    };
    const tuesday = istNinePm('2026-09-08');
    expect(shouldRunNow(tuesday, settings, state).run).toBe(true);
  });

  it('refuses to start while a run is already in progress', () => {
    const state: SchedulerState = { ...freshState(), running: true };
    expect(shouldRunNow(istNinePm('2026-09-07'), settings, state)).toEqual({
      run: false,
      reason: 'in_progress',
    });
  });
});

describe('nextRunAt', () => {
  it('skips the weekend when computing the next run', () => {
    // Friday 21:01 IST -> next run is Monday.
    const friday = new Date('2026-09-11T15:31:00.000Z');
    const next = nextRunAt(settings, friday);
    expect(next).not.toBeNull();
    const parts = zonedParts(new Date(next!), SCHEDULER_TIMEZONE);
    expect(parts.weekday).toBe(1);
    expect(parts.hour).toBe(21);
    expect(parts.minute).toBe(0);
  });

  it('returns null when the scheduler is disabled', () => {
    expect(nextRunAt({ ...settings, enabled: false })).toBeNull();
  });
});
