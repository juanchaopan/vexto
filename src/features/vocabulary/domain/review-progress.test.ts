import { describe, expect, it } from 'vitest';
import { FINAL_ROUND, newProgress, roundLabel } from './review-progress.ts';

describe('newProgress', () => {
  it('starts a mode at round 0 with no due time', () => {
    expect(newProgress()).toEqual({ round: 0, dueAt: null });
  });
});

describe('roundLabel', () => {
  it('names the round of the next answer, one more than the progress round', () => {
    expect(roundLabel(0)).toBe('Round 1');
    expect(roundLabel(6)).toBe('Round 7');
  });

  it('says Complete at the final round', () => {
    expect(roundLabel(FINAL_ROUND)).toBe('Complete');
  });
});
