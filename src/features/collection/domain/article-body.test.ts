import { describe, expect, it } from 'vitest';
import {
  buildArticleBody,
  countWords,
  normalizeParagraph,
  withinWordLimits,
  withoutTitleParagraph,
} from './article-body.ts';

describe('normalizeParagraph', () => {
  it('joins white space into single spaces and trims the ends', () => {
    expect(normalizeParagraph('  The\tquick\n\n brown fox  ')).toBe('The quick brown fox');
  });

  it('drops invisible characters and turns control characters into spaces', () => {
    expect(normalizeParagraph('co­operate​ now\u0007then')).toBe('cooperate now then');
  });

  it('writes the text in NFC', () => {
    expect(normalizeParagraph('café')).toBe('café');
  });
});

describe('countWords', () => {
  it('counts words and numbers, not punctuation', () => {
    expect(countWords('The rover drove 3.5 km — farther than planned!')).toBe(8);
    expect(countWords(' — ')).toBe(0);
  });
});

describe('withinWordLimits', () => {
  it('includes both limits', () => {
    const limits = { min: 150, max: 1000 };

    expect(withinWordLimits(149, limits)).toBe(false);
    expect(withinWordLimits(150, limits)).toBe(true);
    expect(withinWordLimits(1000, limits)).toBe(true);
    expect(withinWordLimits(1001, limits)).toBe(false);
  });
});

describe('withoutTitleParagraph', () => {
  it('drops a first paragraph that repeats the title', () => {
    expect(withoutTitleParagraph(['A  New Probe', 'Body.'], 'a new probe')).toEqual(['Body.']);
    expect(withoutTitleParagraph(['Intro.', 'A New Probe'], 'A New Probe')).toEqual([
      'Intro.',
      'A New Probe',
    ]);
    expect(withoutTitleParagraph([], 'Title')).toEqual([]);
  });
});

describe('buildArticleBody', () => {
  it('joins sentences with one space and paragraphs with two line feeds', () => {
    const body = buildArticleBody([
      'The team met at dawn.   They checked the gear twice.',
      '',
      '  Then the launch began! ',
    ]);

    expect(body.text).toBe(
      'The team met at dawn. They checked the gear twice.\n\nThen the launch began!',
    );
    expect(body.wordCount).toBe(14);
  });

  it('records each sentence with its paragraph and its range in the body', () => {
    const body = buildArticleBody(['First one. Second one?', 'Third one.']);

    expect(body.sentences).toEqual([
      { text: 'First one.', paragraphIndex: 0, bodyStart: 0, bodyEnd: 10 },
      { text: 'Second one?', paragraphIndex: 0, bodyStart: 11, bodyEnd: 22 },
      { text: 'Third one.', paragraphIndex: 1, bodyStart: 24, bodyEnd: 34 },
    ]);
    for (const sentence of body.sentences) {
      expect(body.text.slice(sentence.bodyStart, sentence.bodyEnd)).toBe(sentence.text);
    }
  });

  it('counts ranges in UTF-16 code units, so they never split a surrogate pair', () => {
    const body = buildArticleBody(['The 🚀 rose. It flew far.']);

    expect(body.sentences.map((s) => body.text.slice(s.bodyStart, s.bodyEnd))).toEqual([
      'The 🚀 rose.',
      'It flew far.',
    ]);
  });

  it('drops paragraphs without letters or digits and keeps stray marks with their sentence', () => {
    const body = buildArticleBody(['* * *', 'It ended. —']);

    expect(body.text).toBe('It ended. —');
    expect(body.sentences).toEqual([
      { text: 'It ended. —', paragraphIndex: 0, bodyStart: 0, bodyEnd: 11 },
    ]);
  });

  it('is empty without paragraphs', () => {
    expect(buildArticleBody([])).toEqual({ text: '', sentences: [], wordCount: 0 });
  });
});
