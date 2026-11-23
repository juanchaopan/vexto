import { describe, expect, it } from 'vitest';
import {
  dueOccurrences,
  latestOccurrence,
  occurrencesBetween,
  zonedTimeToUtc,
} from './schedule.ts';

const newYork = 'America/New_York';
const daily = { timeZone: newYork, times: ['09:00'] };

function utc(text: string) {
  return new Date(text);
}

function iso(dates: Date[]) {
  return dates.map((date) => date.toISOString());
}

describe('zonedTimeToUtc', () => {
  it('turns a local time into UTC with the offset of that date', () => {
    expect(zonedTimeToUtc({ year: 2026, month: 11, day: 20 }, '09:00', newYork)).toEqual(
      utc('2026-11-20T14:00:00Z'),
    );
    expect(zonedTimeToUtc({ year: 2026, month: 7, day: 1 }, '09:00', newYork)).toEqual(
      utc('2026-07-01T13:00:00Z'),
    );
    expect(zonedTimeToUtc({ year: 2026, month: 11, day: 20 }, '09:00', 'Asia/Kolkata')).toEqual(
      utc('2026-11-20T03:30:00Z'),
    );
  });

  it('moves a time the spring change skips to the first moment after the gap', () => {
    // 02:00 EST becomes 03:00 EDT on 8 March 2026, so 02:30 never happens that day.
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8 }, '02:30', newYork)).toEqual(
      utc('2026-03-08T07:00:00Z'),
    );
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8 }, '02:00', newYork)).toEqual(
      utc('2026-03-08T07:00:00Z'),
    );
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8 }, '09:00', newYork)).toEqual(
      utc('2026-03-08T13:00:00Z'),
    );
  });

  it('uses the first of the two moments when the autumn change repeats a time', () => {
    // 02:00 EDT goes back to 01:00 EST on 1 November 2026, so 01:30 happens twice.
    expect(zonedTimeToUtc({ year: 2026, month: 11, day: 1 }, '01:30', newYork)).toEqual(
      utc('2026-11-01T05:30:00Z'),
    );
    expect(zonedTimeToUtc({ year: 2026, month: 11, day: 1 }, '09:00', newYork)).toEqual(
      utc('2026-11-01T14:00:00Z'),
    );
  });
});

describe('occurrencesBetween', () => {
  it('lists the times after the start and up to the end, through a daylight saving change', () => {
    expect(
      iso(occurrencesBetween(daily, utc('2026-03-06T14:00:00Z'), utc('2026-03-09T13:00:00Z'))),
    ).toEqual(['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z', '2026-03-09T13:00:00.000Z']);
  });

  it('runs a repeated local time once on the autumn change', () => {
    const night = { timeZone: newYork, times: ['01:30'] };

    expect(
      iso(occurrencesBetween(night, utc('2026-10-31T12:00:00Z'), utc('2026-11-02T12:00:00Z'))),
    ).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
  });

  it('gives every configured time of each day in order', () => {
    const twice = { timeZone: newYork, times: ['18:00', '09:00'] };

    expect(
      iso(occurrencesBetween(twice, utc('2026-11-20T00:00:00Z'), utc('2026-11-21T00:00:00Z'))),
    ).toEqual(['2026-11-20T14:00:00.000Z', '2026-11-20T23:00:00.000Z']);
  });

  it('is empty when the end is not after the start', () => {
    const time = utc('2026-11-20T14:00:00Z');

    expect(occurrencesBetween(daily, time, time)).toEqual([]);
  });
});

describe('latestOccurrence', () => {
  it('is the latest time at or before the moment', () => {
    expect(latestOccurrence(daily, utc('2026-11-20T13:59:00Z'))).toEqual(
      utc('2026-11-19T14:00:00Z'),
    );
    expect(latestOccurrence(daily, utc('2026-11-20T14:00:00Z'))).toEqual(
      utc('2026-11-20T14:00:00Z'),
    );
  });
});

describe('dueOccurrences', () => {
  const now = utc('2026-11-20T14:10:00Z');

  it('gives the times after the cursor', () => {
    expect(dueOccurrences(daily, utc('2026-11-19T14:00:00Z'), now)).toEqual({
      due: [utc('2026-11-20T14:00:00Z')],
      gaveUpEarlier: false,
    });
    expect(dueOccurrences(daily, utc('2026-11-20T14:00:00Z'), now)).toEqual({
      due: [],
      gaveUpEarlier: false,
    });
  });

  it('takes up to four missed times, from early to late', () => {
    expect(dueOccurrences(daily, utc('2026-11-16T14:00:00Z'), now)).toEqual({
      due: iso4('2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'),
      gaveUpEarlier: false,
    });
  });

  it('gives up the times before the latest four', () => {
    expect(dueOccurrences(daily, utc('2026-11-15T14:00:00Z'), now)).toEqual({
      due: iso4('2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'),
      gaveUpEarlier: true,
    });
    expect(dueOccurrences(daily, utc('2026-01-01T14:00:00Z'), now)).toEqual({
      due: iso4('2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'),
      gaveUpEarlier: true,
    });
  });
});

function iso4(...days: string[]) {
  return days.map((day) => utc(`${day}T14:00:00Z`));
}
