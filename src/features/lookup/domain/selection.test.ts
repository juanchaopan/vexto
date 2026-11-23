import { describe, expect, it } from 'vitest';
import {
  countWords,
  isRangeOf,
  normalizeContext,
  overlapsAny,
  selectableWords,
  selectionExtent,
  selectionProblem,
} from './selection.ts';

const sentence = 'Engineers want equipment that is resilient enough, "really" sticky.';

function extentText(text: string, start: number, end: number) {
  const extent = selectionExtent(text, { start, end });
  return extent && text.slice(extent.start, extent.end);
}

describe('isRangeOf', () => {
  it('accepts whole positions inside the text with something between them', () => {
    expect(isRangeOf('word', { start: 0, end: 4 })).toBe(true);
    expect(isRangeOf('word', { start: 2, end: 2 })).toBe(false);
    expect(isRangeOf('word', { start: 3, end: 1 })).toBe(false);
    expect(isRangeOf('word', { start: -1, end: 2 })).toBe(false);
    expect(isRangeOf('word', { start: 0, end: 5 })).toBe(false);
    expect(isRangeOf('word', { start: 0.5, end: 2 })).toBe(false);
  });
});

describe('selectionExtent', () => {
  it('grows a selection that starts or ends inside a word to the whole word', () => {
    const start = sentence.indexOf('ilien');
    expect(extentText(sentence, start, start + 5)).toBe('resilient');
    const want = sentence.indexOf('want');
    expect(extentText(sentence, want + 2, sentence.indexOf('ment') + 1)).toBe('want equipment');
  });

  it('leaves out the spaces and punctuation at the ends', () => {
    const start = sentence.indexOf('enough');
    expect(extentText(sentence, start - 1, start + 'enough, "really"'.length + 1)).toBe(
      'enough, "really',
    );
    const sticky = sentence.indexOf('sticky');
    expect(extentText(sentence, sticky - 2, sentence.length)).toBe('sticky');
  });

  it('keeps a word joined by an apostrophe or a hyphen whole', () => {
    const text = "the team's fine-grained dust";
    expect(extentText(text, 4, 10)).toBe("team's");
    expect(extentText(text, 11, 15)).toBe('fine');
  });

  it('is null when the selection holds no letter or digit', () => {
    expect(selectionExtent('a — b', { start: 1, end: 4 })).toBeNull();
    expect(selectionExtent('"..."', { start: 0, end: 5 })).toBeNull();
  });

  it('never cuts a character made of two code units in half', () => {
    const text = 'moon 🌕 dust';
    const extent = selectionExtent(text, { start: 6, end: text.length });
    expect(extent && text.slice(extent.start, extent.end)).toBe('dust');
  });
});

describe('countWords', () => {
  it('counts words of letters and digits joined by apostrophes and hyphens', () => {
    expect(countWords("It's a 3-day, fine-grained test — done.")).toBe(6);
    expect(countWords('…')).toBe(0);
  });
});

describe('selectionProblem', () => {
  it('accepts up to 8 words and 80 characters', () => {
    expect(selectionProblem('one two three four five six seven eight')).toBeNull();
    expect(selectionProblem('a'.repeat(80))).toBeNull();
  });

  it('refuses a ninth word and an 81st character', () => {
    expect(selectionProblem('one two three four five six seven eight nine')).toBe('too-long');
    expect(selectionProblem('a'.repeat(81))).toBe('too-long');
  });

  it('counts characters, not code units', () => {
    expect(selectionProblem(`${'a'.repeat(78)}🌕`)).toBeNull();
  });

  it('refuses a selection without a word', () => {
    expect(selectionProblem(' — ')).toBe('empty');
  });
});

describe('overlapsAny', () => {
  it('tells whether a range touches any of the hidden ranges', () => {
    const hidden = [[10, 18] as const];
    expect(overlapsAny({ start: 0, end: 9 }, hidden)).toBe(false);
    expect(overlapsAny({ start: 0, end: 10 }, hidden)).toBe(false);
    expect(overlapsAny({ start: 0, end: 11 }, hidden)).toBe(true);
    expect(overlapsAny({ start: 17, end: 30 }, hidden)).toBe(true);
    expect(overlapsAny({ start: 18, end: 30 }, hidden)).toBe(false);
  });
});

describe('normalizeContext', () => {
  it('makes every run of white space one space and moves the selection with it', () => {
    const text = 'It clings to suits.\n\nEngineers  want\tshields.';
    const start = text.indexOf('suits');
    const end = text.indexOf('want') + 4;

    const normalized = normalizeContext(text, { start, end });

    expect(normalized.text).toBe('It clings to suits. Engineers want shields.');
    expect(normalized.text.slice(normalized.range.start, normalized.range.end)).toBe(
      'suits. Engineers want',
    );
  });

  it('gives the same text and range for the same words broken into lines differently', () => {
    const a = normalizeContext('One.\n\nTwo three.', { start: 6, end: 9 });
    const b = normalizeContext('One. Two three.', { start: 5, end: 8 });

    expect(a).toEqual(b);
  });

  it('drops white space at the ends', () => {
    expect(normalizeContext('  word  ', { start: 2, end: 6 })).toEqual({
      text: 'word',
      range: { start: 0, end: 4 },
    });
  });
});

describe('selectableWords', () => {
  it('lists the words with their ranges, without punctuation', () => {
    expect(selectableWords('Moon dust, "sticky".')).toEqual([
      { text: 'Moon', start: 0, end: 4 },
      { text: 'dust', start: 5, end: 9 },
      { text: 'sticky', start: 12, end: 18 },
    ]);
  });
});
