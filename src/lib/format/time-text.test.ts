import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatFullDateTime, formatTimeUntil } from './time-text.ts';

const timeZone = 'America/New_York';
const now = new Date('2026-11-22T15:00:00Z');

describe('formatDateTime', () => {
  it('leaves out the year in the current year and writes it in another', () => {
    expect(formatDateTime(new Date('2026-11-22T14:04:00Z'), { now, timeZone })).toBe(
      'Nov 22, 09:04',
    );
    expect(formatDateTime(new Date('2025-11-22T14:04:00Z'), { now, timeZone })).toBe(
      'Nov 22, 2025, 09:04',
    );
  });

  it('uses a 24-hour clock', () => {
    expect(formatDateTime(new Date('2026-03-05T22:30:00Z'), { now, timeZone })).toBe(
      'Mar 5, 17:30',
    );
    expect(formatDateTime(new Date('2026-07-04T04:00:00Z'), { now, timeZone })).toBe(
      'Jul 4, 00:00',
    );
  });

  it('decides both years in the shown time zone', () => {
    // 03:30 UTC on 1 January 2027 is still 31 December 2026 in New York.
    const lateNewYearsEve = new Date('2027-01-01T03:30:00Z');

    expect(formatDateTime(lateNewYearsEve, { now: lateNewYearsEve, timeZone })).toBe(
      'Dec 31, 22:30',
    );
    expect(
      formatDateTime(lateNewYearsEve, { now: new Date('2027-01-01T12:00:00Z'), timeZone }),
    ).toBe('Dec 31, 2026, 22:30');
  });
});

describe('formatFullDateTime', () => {
  it('always writes the year', () => {
    expect(formatFullDateTime(new Date('2026-11-22T14:04:00Z'), { timeZone })).toBe(
      'Nov 22, 2026, 09:04',
    );
  });
});

describe('formatDate', () => {
  it('writes the date alone, with the year only outside the current year', () => {
    expect(formatDate(new Date('2026-11-22T15:00:00Z'), { now, timeZone })).toBe('Nov 22');
    expect(formatDate(new Date('2025-02-01T15:00:00Z'), { now, timeZone })).toBe('Feb 1, 2025');
  });
});

describe('formatTimeUntil', () => {
  const later = (ms: number) => new Date(now.getTime() + ms);
  const minute = 60_000;

  it('says Due once the time has come', () => {
    expect(formatTimeUntil(now, now)).toBe('Due');
    expect(formatTimeUntil(later(-minute), now)).toBe('Due');
  });

  it('rounds minutes, hours and days up, in singular and plural', () => {
    expect(formatTimeUntil(later(30_000), now)).toBe('< 1 min');
    expect(formatTimeUntil(later(minute), now)).toBe('1 min');
    expect(formatTimeUntil(later(9 * minute + 1), now)).toBe('10 mins');
    expect(formatTimeUntil(later(59 * minute + 30_000), now)).toBe('1 hour');
    expect(formatTimeUntil(later(3 * 60 * minute), now)).toBe('3 hours');
    expect(formatTimeUntil(later(23 * 60 * minute + 1), now)).toBe('1 day');
    expect(formatTimeUntil(later(3 * 24 * 60 * minute + 1), now)).toBe('4 days');
  });
});
