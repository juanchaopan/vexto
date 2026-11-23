import { describe, expect, it } from 'vitest';
import {
  containsPattern,
  DEFAULT_VOCABULARY_QUERY,
  effectiveRounds,
  isNarrowed,
  ROUND_CHOICES,
  roundsOfChoices,
  sortKeyOf,
} from './vocabulary-query.ts';

describe('effectiveRounds', () => {
  it('keeps the chosen rounds in the order of the options and drops unknown values', () => {
    expect(effectiveRounds(['complete', '3', 'x', '1'])).toEqual(['1', '3', 'complete']);
  });

  it('takes every round chosen as no filter', () => {
    expect(effectiveRounds([...ROUND_CHOICES])).toEqual([]);
  });
});

describe('roundsOfChoices', () => {
  it('matches Round n with round n − 1 and Complete with the final round', () => {
    expect(roundsOfChoices(['1', '4', 'complete'])).toEqual([0, 3, 7]);
  });
});

describe('sortKeyOf', () => {
  it('reads the word sort and each mode’s round and next sorts', () => {
    expect(sortKeyOf('word')).toEqual({ kind: 'word' });
    expect(sortKeyOf('speakRound')).toEqual({ kind: 'round', mode: 'speak' });
    expect(sortKeyOf('spellNext')).toEqual({ kind: 'next', mode: 'spell' });
    expect(sortKeyOf('translateRound')).toEqual({ kind: 'round', mode: 'translate' });
  });
});

describe('isNarrowed', () => {
  it('is false for every card and true with a tab, a search or a round filter', () => {
    expect(isNarrowed(DEFAULT_VOCABULARY_QUERY)).toBe(false);
    expect(isNarrowed({ ...DEFAULT_VOCABULARY_QUERY, state: 'new' })).toBe(true);
    expect(isNarrowed({ ...DEFAULT_VOCABULARY_QUERY, q: 'run' })).toBe(true);
    expect(
      isNarrowed({
        ...DEFAULT_VOCABULARY_QUERY,
        rounds: { speak: [], spell: ['2'], translate: [] },
      }),
    ).toBe(true);
  });

  it('does not count the sort', () => {
    expect(isNarrowed({ ...DEFAULT_VOCABULARY_QUERY, sort: 'spellNext', direction: 'desc' })).toBe(
      false,
    );
  });
});

describe('containsPattern', () => {
  it('matches the text anywhere', () => {
    expect(containsPattern('run')).toBe('%run%');
  });

  it('escapes the wildcards and the escape character so they match only themselves', () => {
    expect(containsPattern('5%_a\\b')).toBe('%5\\%\\_a\\\\b%');
  });
});
