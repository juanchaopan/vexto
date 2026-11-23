import { describe, expect, it } from 'vitest';
import { newestFirst, parseFeedDate, takeNew } from './entry-selection.ts';

describe('parseFeedDate', () => {
  it.each([
    ['Thu, 05 Nov 2026 12:00:00 GMT', '2026-11-05T12:00:00.000Z'],
    ['Thu, 05 Nov 2026 07:00:00 -0500', '2026-11-05T12:00:00.000Z'],
    ['5 Nov 2026 08:00 EDT', '2026-11-05T12:00:00.000Z'],
    ['Thu,05 Nov 2026 12:00:00 +0000', '2026-11-05T12:00:00.000Z'],
    ['2026-11-05T12:00:00Z', '2026-11-05T12:00:00.000Z'],
    ['2026-11-05T07:00:00.250-05:00', '2026-11-05T12:00:00.000Z'],
    ['2026-11-05T17:30:00+0530', '2026-11-05T12:00:00.000Z'],
    ['2026-11-05', '2026-11-05T00:00:00.000Z'],
  ])('reads %s', (text, expected) => {
    expect(parseFeedDate(text)?.toISOString()).toBe(expected);
  });

  it.each([
    ['11/05/2026 - 12:00'],
    ['Thu, 05 Nov 26 12:00:00 GMT'],
    ['Thu, 05 Nov 2026 12:00:00'],
    ['Thu, 05 Nov 2026 12:00:00 XYZ'],
    ['Thu, 31 Feb 2026 12:00:00 GMT'],
    ['2026-13-01T00:00:00Z'],
    ['2026-11-05T25:00:00Z'],
    ['2026-11-05T12:00:00'],
    ['yesterday'],
    [''],
  ])('cannot read %j', (text) => {
    expect(parseFeedDate(text)).toBeNull();
  });

  it('is null without a time', () => {
    expect(parseFeedDate(null)).toBeNull();
  });
});

describe('newestFirst', () => {
  const firstSeen = new Date('2026-11-20T14:00:00Z');
  const entry = (name: string, published: string | null) => ({
    name,
    published: published ? new Date(published) : null,
  });

  it('orders by published time from new to old', () => {
    const entries = [
      entry('old', '2026-11-01T00:00:00Z'),
      entry('new', '2026-11-10T00:00:00Z'),
      entry('middle', '2026-11-05T00:00:00Z'),
    ];

    expect(newestFirst(entries, (e) => e.published, firstSeen).map((e) => e.name)).toEqual([
      'new',
      'middle',
      'old',
    ]);
  });

  it('counts an unreadable time as the first-seen time and keeps the feed order on ties', () => {
    const entries = [
      entry('dated', '2026-11-19T00:00:00Z'),
      entry('undated-a', null),
      entry('same-a', '2026-11-18T00:00:00Z'),
      entry('undated-b', null),
      entry('same-b', '2026-11-18T00:00:00Z'),
    ];

    expect(newestFirst(entries, (e) => e.published, firstSeen).map((e) => e.name)).toEqual([
      'undated-a',
      'undated-b',
      'dated',
      'same-a',
      'same-b',
    ]);
  });
});

describe('takeNew', () => {
  it('takes the newest entries that are new, and no older ones in place of the rest', () => {
    const ordered = ['a', 'b', 'c', 'd'];

    expect(takeNew(ordered, (e) => e !== 'a', 2)).toEqual(['b', 'c']);
    expect(takeNew(ordered, (e) => e === 'd', 2)).toEqual(['d']);
    expect(takeNew(ordered, () => false, 2)).toEqual([]);
  });
});
