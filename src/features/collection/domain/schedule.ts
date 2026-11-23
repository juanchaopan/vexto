// Collection times of a feed (.docs/design/rules.md, 调度). Each feed collects at local times of
// its IANA time zone; the times are worked out as UTC instants. A local time that a daylight
// saving change skips moves to the first moment that exists after the gap, and a local time that
// happens twice is used the first time only.
import { MAX_DUE_OCCURRENCES } from './collection-state.ts';

export type FeedSchedule = {
  readonly timeZone: string;
  /** Local times, HH:MM on a 24-hour clock. */
  readonly times: readonly string[];
};

type LocalDate = { year: number; month: number; day: number };

const SECOND_MS = 1000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The local wall-clock reading of an instant, written as if it were a UTC time. */
function wallClockAt(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** How far the time zone's clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / SECOND_MS) * SECOND_MS;
  return wallClockAt(whole, timeZone) - whole;
}

/** The first instant in [from, to] whose offset is `offset`: the end of a skipped hour. */
function firstInstantWithOffset(from: number, to: number, offset: number, timeZone: string) {
  let low = from;
  let high = to;
  while (high - low > SECOND_MS) {
    const middle = Math.floor((low + high) / 2 / SECOND_MS) * SECOND_MS;
    if (offsetAt(middle, timeZone) === offset) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

function parseTime(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

/** The UTC instant of a local date and time in the time zone. */
export function zonedTimeToUtc(date: LocalDate, time: string, timeZone: string): Date {
  const { hour, minute } = parseTime(time);
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  // Offsets a day either side are those before and after any change near this time.
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const matches = [wall - before, wall - after]
    .filter((instant) => wallClockAt(instant, timeZone) === wall)
    .sort((a, b) => a - b);
  if (matches.length > 0) {
    return new Date(matches[0]);
  }
  const from = Math.min(wall - before, wall - after);
  const to = Math.max(wall - before, wall - after);
  return new Date(firstInstantWithOffset(from, to, after, timeZone));
}

function localDateAt(instant: number, timeZone: string): LocalDate {
  const wall = new Date(wallClockAt(instant, timeZone));
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() };
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function dateValue(date: LocalDate) {
  return Date.UTC(date.year, date.month - 1, date.day);
}

/** The collection times after `after` and up to and including `until`, from early to late. */
export function occurrencesBetween(schedule: FeedSchedule, after: Date, until: Date): Date[] {
  const start = after.getTime();
  const end = until.getTime();
  if (end <= start) {
    return [];
  }
  const found = new Set<number>();
  const last = dateValue(addLocalDays(localDateAt(end, schedule.timeZone), 1));
  let date = addLocalDays(localDateAt(start, schedule.timeZone), -1);
  while (dateValue(date) <= last) {
    for (const time of schedule.times) {
      const instant = zonedTimeToUtc(date, time, schedule.timeZone).getTime();
      if (instant > start && instant <= end) {
        found.add(instant);
      }
    }
    date = addLocalDays(date, 1);
  }
  return [...found].sort((a, b) => a - b).map((instant) => new Date(instant));
}

/** The latest collection time at or before `time`; a new feed's cursor starts there. */
export function latestOccurrence(schedule: FeedSchedule, time: Date): Date {
  const earlier = new Date(time.getTime() - 3 * DAY_MS);
  const occurrences = occurrencesBetween(schedule, earlier, time);
  return occurrences[occurrences.length - 1];
}

export type DueOccurrences = {
  /** The collection times to process now, from early to late. */
  due: Date[];
  /** Whether earlier collection times were due as well and are given up. */
  gaveUpEarlier: boolean;
};

/**
 * The collection times due after the cursor, up to `now`: at most the latest four, so a feed
 * that was not collected for a long time does not fetch its whole backlog.
 */
export function dueOccurrences(
  schedule: FeedSchedule,
  lastOccurrence: Date,
  now: Date,
  max: number = MAX_DUE_OCCURRENCES,
): DueOccurrences {
  // Every feed collects at least once a day, so the latest `max` times lie within this window.
  const windowStart = Math.max(lastOccurrence.getTime(), now.getTime() - (max + 2) * DAY_MS);
  const occurrences = occurrencesBetween(schedule, new Date(windowStart), now);
  return {
    due: occurrences.slice(-max),
    gaveUpEarlier: occurrences.length > max || windowStart > lastOccurrence.getTime(),
  };
}
