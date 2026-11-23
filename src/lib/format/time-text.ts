// The time texts of the interface (.docs/design/screens.md, 时间文字): English month
// abbreviations, a 24-hour clock, and the year left out when the time falls in the current year.
// Times are shown in the device's time zone; the zone can be given to make the text fixed, as
// the tests do. The browser and the server use the same functions, so both write the same text.

type ZonedParts = { year: number; month: string; day: number; time: string };

/** One formatter per time zone, the device's own under the empty key: lists format many times. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

function zonedParts(date: Date, timeZone: string | undefined): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return {
    year: Number(part('year')),
    month: part('month'),
    day: Number(part('day')),
    time: `${part('hour')}:${part('minute')}`,
  };
}

export type TimeTextOptions = {
  /** The moment that decides the current year; the present by default. */
  now?: Date;
  /** IANA time zone to show the time in; the device's own by default. */
  timeZone?: string;
};

function withYearUnlessCurrent(parts: ZonedParts, options: TimeTextOptions) {
  const current = zonedParts(options.now ?? new Date(), options.timeZone).year;
  return parts.year === current
    ? `${parts.month} ${parts.day}`
    : `${parts.month} ${parts.day}, ${parts.year}`;
}

/**
 * A date and time on an article card: `Nov 22, 09:04` in the current year,
 * `Nov 22, 2025, 09:04` in another.
 */
export function formatDateTime(date: Date, options: TimeTextOptions = {}): string {
  const parts = zonedParts(date, options.timeZone);
  return `${withYearUnlessCurrent(parts, options)}, ${parts.time}`;
}

/** A date and time that always shows the year, as at the end of an article: `Nov 22, 2026, 09:04`. */
export function formatFullDateTime(date: Date, options: Omit<TimeTextOptions, 'now'> = {}): string {
  const parts = zonedParts(date, options.timeZone);
  return `${parts.month} ${parts.day}, ${parts.year}, ${parts.time}`;
}

/** A date without a time, as in the terms acceptance: `Nov 22` in the current year, `Nov 22, 2025` in another. */
export function formatDate(date: Date, options: TimeTextOptions = {}): string {
  return withYearUnlessCurrent(zonedParts(date, options.timeZone), options);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function count(amount: number, unit: string) {
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`;
}

/**
 * How long until a review is due: `Due` once it is due, `< 1 min` within a minute, and otherwise
 * minutes, hours or days rounded up, such as `10 mins`, `1 hour` or `4 days`.
 */
export function formatTimeUntil(dueAt: Date, now: Date = new Date()): string {
  const left = dueAt.getTime() - now.getTime();
  if (left <= 0) {
    return 'Due';
  }
  if (left < MINUTE) {
    return '< 1 min';
  }
  const minutes = Math.ceil(left / MINUTE);
  if (minutes < 60) {
    return count(minutes, 'min');
  }
  const hours = Math.ceil(left / HOUR);
  if (hours < 24) {
    return count(hours, 'hour');
  }
  return count(Math.ceil(left / DAY), 'day');
}
