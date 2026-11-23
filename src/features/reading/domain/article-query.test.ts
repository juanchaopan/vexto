import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARTICLE_QUERY,
  effectiveChoices,
  isNarrowed,
  rankByName,
} from './article-query.ts';

describe('effectiveChoices', () => {
  const options = ['a', 'b', 'c'];

  it('keeps the chosen keys in the order of the options', () => {
    expect(effectiveChoices(['c', 'a'], options)).toEqual(['a', 'c']);
  });

  it('treats choosing every option as choosing none', () => {
    expect(effectiveChoices(['b', 'c', 'a'], options)).toEqual([]);
  });

  it('drops keys that are not options', () => {
    expect(effectiveChoices(['a', 'z'], options)).toEqual(['a']);
  });
});

describe('isNarrowed', () => {
  it('is false for the default query', () => {
    expect(isNarrowed(DEFAULT_ARTICLE_QUERY)).toBe(false);
  });

  it.each([{ q: 'moon' }, { feeds: ['nist-news'] }, { categories: ['health'] }])(
    'is true with %o',
    (change) => {
      expect(isNarrowed({ ...DEFAULT_ARTICLE_QUERY, ...change })).toBe(true);
    },
  );

  it('does not count the sort', () => {
    expect(isNarrowed({ ...DEFAULT_ARTICLE_QUERY, sort: 'article', direction: 'asc' })).toBe(false);
  });
});

describe('rankByName', () => {
  it('ranks keys by display name, A to Z without regard to case', () => {
    const ranks = rankByName([
      { key: 'nist', name: 'NIST News' },
      { key: 'adams', name: 'inside Adams' },
      { key: 'nasa', name: 'NASA Technology' },
    ]);

    expect([...ranks]).toEqual([
      ['adams', 0],
      ['nasa', 1],
      ['nist', 2],
    ]);
  });

  it('orders equal names by key', () => {
    const ranks = rankByName([
      { key: 'b', name: 'Same' },
      { key: 'a', name: 'same' },
    ]);

    expect(ranks.get('a')).toBe(0);
    expect(ranks.get('b')).toBe(1);
  });
});
