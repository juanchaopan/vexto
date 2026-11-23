// Spell examples with the target hidden (.docs/design/interfaces.md, 下一题): the shown parts keep
// their places in the whole example, every hidden word is one gap, and the browser rebuilds the
// gaps' places from the parts to keep lookups on one side of a blank.
import { describe, expect, it } from 'vitest';
import {
  clozeSegments,
  gapRanges,
  mergeRanges,
  standInText,
  touchesGap,
  type ClozeSegment,
} from './cloze.ts';

const text = 'A resilient city can adapt to unexpected challenges.';

describe('Spell examples', () => {
  it('cut the example around the hidden word', () => {
    expect(clozeSegments(text, [[2, 11]])).toEqual([
      { start: 0, text: 'A ' },
      { gap: true },
      { start: 11, text: ' city can adapt to unexpected challenges.' },
    ]);
  });

  it('never carry the hidden word', () => {
    const segments = clozeSegments(text, [[2, 11]]);
    expect(JSON.stringify(segments)).not.toContain('resilient');
  });

  it('hide a word at the start, one at the end and every repeat', () => {
    const repeated = 'Resilient people stay resilient';
    expect(
      clozeSegments(repeated, [
        [0, 9],
        [22, 31],
      ]),
    ).toEqual([{ gap: true }, { start: 9, text: ' people stay ' }, { gap: true }]);
  });

  it('make ranges that overlap or touch one gap', () => {
    expect(
      mergeRanges([
        [5, 8],
        [0, 3],
        [3, 4],
        [6, 9],
      ]),
    ).toEqual([
      [0, 4],
      [5, 9],
    ]);
    expect(
      clozeSegments('abcdef', [
        [1, 3],
        [2, 4],
      ]),
    ).toEqual([{ start: 0, text: 'a' }, { gap: true }, { start: 4, text: 'ef' }]);
  });

  it('give the browser the gaps’ places and a text of the same length', () => {
    const segments = clozeSegments(text, [[2, 11]]);
    expect(gapRanges(segments)).toEqual([[2, 11]]);
    const standIn = standInText(segments);
    expect(standIn).toHaveLength(text.length);
    expect(standIn.slice(11)).toBe(text.slice(11));
    expect(standIn.slice(2, 11).trim()).toBe('');
  });

  it('give a gap at the very end one character', () => {
    const segments: ClozeSegment[] = [{ start: 0, text: 'They are ' }, { gap: true }];
    expect(gapRanges(segments)).toEqual([[9, 10]]);
    expect(standInText(segments)).toHaveLength(10);
  });

  it('tell a range that reaches into a blank from one beside it', () => {
    const segments = clozeSegments(text, [[2, 11]]);
    expect(touchesGap(segments, [0, 1])).toBe(false);
    expect(touchesGap(segments, [12, 16])).toBe(false);
    expect(touchesGap(segments, [0, 16])).toBe(true);
    expect(touchesGap(segments, [10, 16])).toBe(true);
  });
});
