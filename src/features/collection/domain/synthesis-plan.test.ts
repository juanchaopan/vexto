import { describe, expect, it } from 'vitest';
import {
  budgetReached,
  isLastAttempt,
  nextSynthesisStep,
  nextUtcMonthStart,
  utcMonthOf,
} from './synthesis-plan.ts';

describe('budgetReached', () => {
  const budget = { vcpuSeconds: 192000, gibSeconds: 360000 };

  it('is reached when either measure reaches its budget', () => {
    expect(budgetReached({ vcpuSeconds: 191999, gibSeconds: 191999 }, budget)).toBe(false);
    expect(budgetReached({ vcpuSeconds: 192000, gibSeconds: 192000 }, budget)).toBe(true);
    expect(budgetReached({ vcpuSeconds: 100, gibSeconds: 360000 }, budget)).toBe(true);
  });
});

describe('UTC months', () => {
  it('names the month of a moment by its first day in UTC', () => {
    expect(utcMonthOf(new Date('2026-11-30T23:59:59Z'))).toBe('2026-11-01');
    expect(utcMonthOf(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12-01');
  });

  it('finds the first moment of the next month, across a year', () => {
    expect(nextUtcMonthStart(new Date('2026-11-20T14:00:00Z'))).toEqual(
      new Date('2026-12-01T00:00:00Z'),
    );
    expect(nextUtcMonthStart(new Date('2026-12-31T23:00:00Z'))).toEqual(
      new Date('2027-01-01T00:00:00Z'),
    );
  });
});

describe('nextSynthesisStep', () => {
  const ready = { attempts: 0, maxAttempts: 5, windowOpen: true, budgetReached: false };

  it('synthesizes while attempts, time and budget are left', () => {
    expect(nextSynthesisStep(ready)).toBe('synthesize');
    expect(nextSynthesisStep({ ...ready, attempts: 4 })).toBe('synthesize');
  });

  it('fails an article whose attempts are all used', () => {
    expect(nextSynthesisStep({ ...ready, attempts: 5, budgetReached: true })).toBe('give-up');
  });

  it('leaves the article to the next run once the synthesis window has passed', () => {
    expect(nextSynthesisStep({ ...ready, windowOpen: false, budgetReached: true })).toBe(
      'wait-for-next-run',
    );
  });

  it('defers to the next month when the budget is spent', () => {
    expect(nextSynthesisStep({ ...ready, budgetReached: true })).toBe('defer-to-next-month');
  });
});

describe('isLastAttempt', () => {
  it('is the attempt that uses the last one', () => {
    expect(isLastAttempt(4, 5)).toBe(false);
    expect(isLastAttempt(5, 5)).toBe(true);
  });
});
