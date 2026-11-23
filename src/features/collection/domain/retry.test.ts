import { describe, expect, it } from 'vitest';
import { addMinutes, afterFeedReadFailure, retryDelayMinutes, retryTime } from './retry.ts';

const now = new Date('2026-11-20T14:00:00Z');

describe('retryDelayMinutes', () => {
  it('waits 15, 30, 60 and 120 minutes after the 1st to 4th attempt', () => {
    expect([1, 2, 3, 4].map(retryDelayMinutes)).toEqual([15, 30, 60, 120]);
  });

  it('waits as long as after the 4th for later attempts', () => {
    expect(retryDelayMinutes(5)).toBe(120);
    expect(retryDelayMinutes(0)).toBe(15);
  });
});

describe('retryTime', () => {
  it('adds the wait to the moment', () => {
    expect(retryTime(now, 2)).toEqual(new Date('2026-11-20T14:30:00Z'));
    expect(addMinutes(now, -60)).toEqual(new Date('2026-11-20T13:00:00Z'));
  });
});

describe('afterFeedReadFailure', () => {
  it('counts the failure and waits until the 4th one', () => {
    expect(afterFeedReadFailure(0, now)).toEqual({
      kind: 'retry',
      failedAttempts: 1,
      retryAt: new Date('2026-11-20T14:15:00Z'),
    });
    expect(afterFeedReadFailure(3, now)).toEqual({
      kind: 'retry',
      failedAttempts: 4,
      retryAt: new Date('2026-11-20T16:00:00Z'),
    });
  });

  it('gives the collection time up at the 5th failure', () => {
    expect(afterFeedReadFailure(4, now)).toEqual({ kind: 'give-up' });
  });
});
