// The rounds and waits of the reviews (.docs/design/rules.md, 轮次和间隔): right answers move one
// round on with the fixed waits, the seventh round completes the mode, a wrong answer moves one
// round back (never below 0) and comes back in 10 minutes, and only a new word or a due, unfinished
// mode can be answered.
import { describe, expect, it } from 'vitest';
import { FINAL_ROUND } from '../../vocabulary/domain/review-progress.ts';
import {
  COMPLETE_ROUND,
  dueAfter,
  isAnswerable,
  isNewWord,
  stepAfter,
  waitToReach,
} from './schedule.ts';

const now = new Date('2026-11-22T10:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('the schedule', () => {
  it('completes a mode at the vocabulary’s final round', () => {
    expect(COMPLETE_ROUND).toBe(FINAL_ROUND);
  });

  it.each([
    [0, 1, 1],
    [1, 2, 2],
    [2, 3, 4],
    [3, 4, 7],
    [4, 5, 15],
    [5, 6, 30],
  ])('moves a right answer at round %i to round %i, due in %i days', (round, next, days) => {
    expect(stepAfter(round, true)).toEqual({ round: next, wait: { unit: 'day', amount: days } });
  });

  it('completes the mode with the right answer at round 6, with no due time', () => {
    expect(stepAfter(6, true)).toEqual({ round: 7, wait: null });
    expect(dueAfter(now, null)).toBeNull();
  });

  it.each([
    [0, 0],
    [1, 0],
    [3, 2],
    [6, 5],
  ])('moves a wrong answer at round %i back to round %i, due in 10 minutes', (round, back) => {
    expect(stepAfter(round, false)).toEqual({
      round: back,
      wait: { unit: 'minute', amount: 10 },
    });
  });

  it('counts a day as 24 hours and a minute as 60 seconds', () => {
    expect(dueAfter(now, { unit: 'day', amount: 4 })?.getTime()).toBe(now.getTime() + 4 * DAY);
    expect(dueAfter(now, { unit: 'minute', amount: 10 })?.getTime()).toBe(
      now.getTime() + 10 * 60_000,
    );
  });

  it('names the wait of reaching each round', () => {
    expect(waitToReach(3)).toEqual({ unit: 'day', amount: 4 });
    expect(waitToReach(7)).toBeNull();
  });
});

describe('what can be answered', () => {
  it('a new word: round 0 with no due time', () => {
    expect(isNewWord({ round: 0, dueAt: null })).toBe(true);
    expect(isAnswerable({ round: 0, dueAt: null }, now)).toBe(true);
  });

  it('a mode whose due time has come, also at the very moment', () => {
    expect(isAnswerable({ round: 2, dueAt: new Date(now.getTime() - HOUR) }, now)).toBe(true);
    expect(isAnswerable({ round: 0, dueAt: now }, now)).toBe(true);
  });

  it('not a mode due later, such as one answered wrongly a moment ago', () => {
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(isAnswerable({ round: 0, dueAt: later }, now)).toBe(false);
    expect(isNewWord({ round: 0, dueAt: later })).toBe(false);
    expect(isAnswerable({ round: 3, dueAt: new Date(now.getTime() + DAY) }, now)).toBe(false);
  });

  it('not a completed mode', () => {
    expect(isAnswerable({ round: 7, dueAt: null }, now)).toBe(false);
  });
});
