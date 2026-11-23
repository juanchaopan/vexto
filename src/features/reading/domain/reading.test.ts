import { describe, expect, it } from 'vitest';
import {
  articleSelection,
  countWords,
  listeningMinutes,
  queueFrom,
  sentenceAt,
  sentenceContext,
  wordPieces,
  type ReadingSentence,
} from './reading.ts';

describe('countWords', () => {
  it('counts words joined by apostrophes and hyphens as one', () => {
    expect(countWords(["Moon dust isn't fine-grained.", 'It clings — to 3 suits.'])).toBe(9);
  });

  it('counts nothing in empty text', () => {
    expect(countWords(['', '…'])).toBe(0);
  });
});

describe('listeningMinutes', () => {
  it.each([
    [0, 1],
    [1_000, 1],
    [60_000, 1],
    [60_001, 2],
    [154_000, 3],
  ])('rounds %i ms up to %i minutes, at least 1', (ms, minutes) => {
    expect(listeningMinutes(ms)).toBe(minutes);
  });
});

describe('sentenceAt', () => {
  const timings = [
    { startMs: 0, endMs: 1_000 },
    { startMs: 1_300, endMs: 2_500 },
    { startMs: 2_800, endMs: 4_000 },
  ];

  it.each([
    [0, 0],
    [999, 0],
    [1_200, 0],
    [1_300, 1],
    [2_799, 1],
    [2_800, 2],
    [9_999, 2],
  ])('puts %i ms in sentence %i', (ms, index) => {
    expect(sentenceAt(timings, ms)).toBe(index);
  });

  it('puts a moment before the first sentence in the first', () => {
    expect(sentenceAt([{ startMs: 200, endMs: 900 }], 0)).toBe(0);
  });
});

describe('queueFrom', () => {
  it('starts at the article and keeps the ones after it', () => {
    expect(queueFrom(['a', 'b', 'c', 'd'], 'c')).toEqual(['c', 'd']);
  });

  it('plays an article the list no longer holds alone', () => {
    expect(queueFrom(['a', 'b'], 'x')).toEqual(['x']);
  });
});

describe('wordPieces', () => {
  it('places each word without the punctuation around it', () => {
    expect(wordPieces('"Moon dust," is sticky.')).toEqual([
      { kind: 'word', text: '"Moon', start: 1, end: 5 },
      { kind: 'space', text: ' ' },
      { kind: 'word', text: 'dust,"', start: 6, end: 10 },
      { kind: 'space', text: ' ' },
      { kind: 'word', text: 'is', start: 13, end: 15 },
      { kind: 'space', text: ' ' },
      { kind: 'word', text: 'sticky.', start: 16, end: 22 },
    ]);
  });

  it('keeps a run without letters as it is', () => {
    expect(wordPieces('a — b')).toEqual([
      { kind: 'word', text: 'a', start: 0, end: 1 },
      { kind: 'space', text: ' ' },
      { kind: 'space', text: '—' },
      { kind: 'space', text: ' ' },
      { kind: 'word', text: 'b', start: 4, end: 5 },
    ]);
  });
});

const sentences: ReadingSentence[] = [
  { index: 0, paragraphIndex: 0, text: 'Moon dust is sticky.' },
  { index: 1, paragraphIndex: 0, text: 'It clings to suits.' },
  { index: 2, paragraphIndex: 1, text: 'Engineers want shields.' },
];

describe('sentenceContext', () => {
  it('joins sentences of a paragraph with a space and paragraphs with two line feeds', () => {
    expect(sentenceContext(sentences, 0, 2)).toEqual({
      text: 'Moon dust is sticky. It clings to suits.\n\nEngineers want shields.',
      starts: [0, 21, 42],
    });
  });

  it('holds one sentence alone', () => {
    expect(sentenceContext(sentences, 1, 1)).toEqual({ text: 'It clings to suits.', starts: [0] });
  });
});

describe('articleSelection', () => {
  it('places a selection inside one sentence', () => {
    expect(
      articleSelection(sentences, { sentence: 0, offset: 5 }, { sentence: 0, offset: 9 }),
    ).toEqual({ firstSentence: 0, lastSentence: 0, start: 5, end: 9, text: 'dust' });
  });

  it('places a selection across a paragraph break, in either order', () => {
    const expected = {
      firstSentence: 1,
      lastSentence: 2,
      start: 13,
      end: 30,
      text: 'suits.\n\nEngineers',
    };
    const anchor = { sentence: 1, offset: 13 };
    const focus = { sentence: 2, offset: 9 };

    expect(articleSelection(sentences, anchor, focus)).toEqual(expected);
    expect(articleSelection(sentences, focus, anchor)).toEqual(expected);
  });

  it('leaves out the spaces at the ends and the sentences only they touch', () => {
    expect(
      articleSelection(sentences, { sentence: 0, offset: 20 }, { sentence: 1, offset: 9 }),
    ).toEqual({ firstSentence: 1, lastSentence: 1, start: 0, end: 9, text: 'It clings' });
  });

  it('is null when the selection holds no text', () => {
    expect(
      articleSelection(sentences, { sentence: 0, offset: 20 }, { sentence: 1, offset: 0 }),
    ).toBeNull();
    expect(
      articleSelection(sentences, { sentence: 1, offset: 3 }, { sentence: 1, offset: 3 }),
    ).toBeNull();
  });
});
