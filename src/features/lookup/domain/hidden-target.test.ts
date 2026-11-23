import { describe, expect, it } from 'vitest';
import { spellHiddenRanges } from './hidden-target.ts';

describe('spellHiddenRanges', () => {
  it('hides the stored ranges and every accepted form the stored ranges missed', () => {
    const text = 'They set off early, and set out again after they Set Off.';

    expect(spellHiddenRanges(text, [[5, 12]], ['set off', 'set out'])).toEqual([
      [5, 12],
      [5, 12],
      [24, 31],
      [49, 56],
    ]);
  });

  it('keeps a stored range no accepted form matches', () => {
    expect(spellHiddenRanges('They left before sunrise.', [[5, 9]], ['set off'])).toEqual([[5, 9]]);
  });
});
