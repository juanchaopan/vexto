// Which entries of a feed one collection time takes (.docs/design/rules.md, 选条目): the entries
// go from the newest to the oldest by their published time, and the newest ones not seen before
// are taken, as many as the feed collects per time. An entry whose published time cannot be read
// counts as published when the job first sees it; entries with the same time keep the feed's
// order.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Offsets of the zone names RFC 822 allows, in minutes east of UTC. */
const ZONES: Readonly<Record<string, number>> = {
  gmt: 0,
  ut: 0,
  utc: 0,
  z: 0,
  est: -300,
  edt: -240,
  cst: -360,
  cdt: -300,
  mst: -420,
  mdt: -360,
  pst: -480,
  pdt: -420,
};

const RFC_822 =
  /^(?:[a-z]{3},\s*)?(\d{1,2})\s+([a-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([a-z]{1,3}|[+-]\d{4})$/i;

const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2}))?$/i;

type Fields = { year: number; month: number; day: number; hour: number; minute: number };

/** Minutes east of UTC of a zone written as a name, +hhmm or +hh:mm; null when unknown. */
function zoneOffset(zone: string): number | null {
  const named = ZONES[zone.toLowerCase()];
  if (named !== undefined) {
    return named;
  }
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) {
    return null;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** The instant of the fields in a zone, or null when a field is out of its range. */
function instantOf(fields: Fields, second: number, offsetMinutes: number): Date | null {
  const { year, month, day, hour, minute } = fields;
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid =
    local.getUTCFullYear() === year &&
    local.getUTCMonth() === month - 1 &&
    local.getUTCDate() === day &&
    hour < 24 &&
    minute < 60 &&
    second < 60;
  return valid ? new Date(local.getTime() - offsetMinutes * 60_000) : null;
}

function parseRfc822(text: string): Date | null {
  const match = RFC_822.exec(text);
  if (!match) {
    return null;
  }
  const month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
  const offset = zoneOffset(match[7]);
  if (month === 0 || offset === null) {
    return null;
  }
  const fields = {
    year: Number(match[3]),
    month,
    day: Number(match[1]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  return instantOf(fields, Number(match[6] ?? 0), offset);
}

function parseIso8601(text: string): Date | null {
  const match = ISO_8601.exec(text);
  if (!match) {
    return null;
  }
  const offset = match[7] === undefined ? 0 : zoneOffset(match[7]);
  if (offset === null) {
    return null;
  }
  const fields = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
  };
  return instantOf(fields, Number(match[6] ?? 0), offset);
}

/**
 * The published time of an entry, written as RFC 822 (RSS) or ISO 8601 (Atom), with a four-digit
 * year and a time zone. Anything else, such as `11/05/2026 - 12:00` or a two-digit year, is null.
 */
export function parseFeedDate(text: string | null): Date | null {
  const trimmed = text?.trim();
  if (!trimmed) {
    return null;
  }
  return parseRfc822(trimmed) ?? parseIso8601(trimmed);
}

/**
 * The entries from the newest to the oldest. `publishedOf` gives an entry's published time, or
 * null when it cannot be read; such an entry counts as published at `firstSeenAt`.
 */
export function newestFirst<T>(
  entries: readonly T[],
  publishedOf: (entry: T) => Date | null,
  firstSeenAt: Date,
): T[] {
  return entries
    .map((entry, order) => ({ entry, order, time: (publishedOf(entry) ?? firstSeenAt).getTime() }))
    .sort((a, b) => b.time - a.time || a.order - b.order)
    .map(({ entry }) => entry);
}

/**
 * The first `count` entries that are new. Only these are processed: when some of them are
 * skipped, fewer articles are collected, and older entries never fill their place.
 */
export function takeNew<T>(
  ordered: readonly T[],
  isNew: (entry: T) => boolean,
  count: number,
): T[] {
  return ordered.filter(isNew).slice(0, count);
}
