export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Wall-clock parts of an instant in a named IANA timezone. Uses Intl rather
 * than a fixed offset so DST changes never need a code change.
 */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.get('hour'));
  return {
    year: Number(parts.get('year')),
    month: Number(parts.get('month')),
    day: Number(parts.get('day')),
    // Intl emits "24" for midnight in some ICU versions.
    hour: hour === 24 ? 0 : hour,
    minute: Number(parts.get('minute')),
    weekday: WEEKDAY_INDEX[parts.get('weekday') ?? 'Mon'] ?? 1,
  };
}

/** `YYYY-MM-DD` in the given timezone. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `YYYY-MM-DDTHH:mm` in the given timezone — the duplicate-run key. */
export function zonedMinuteKey(date: Date, timeZone: string): string {
  const { hour, minute } = zonedParts(date, timeZone);
  return `${zonedDateKey(date, timeZone)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function isWeekday(date: Date, timeZone: string): boolean {
  const { weekday } = zonedParts(date, timeZone);
  return weekday >= 1 && weekday <= 5;
}
