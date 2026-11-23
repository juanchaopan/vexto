import { describe, expect, it } from 'vitest';
import {
  changedSelection,
  decisionOf,
  missingIds,
  sameCards,
  SELECTION_MAX,
} from './save-decision.ts';

const at = (id: string, updatedAt = '2026-11-23T10:00:00.000Z') => ({ id, updatedAt });

describe('sameCards', () => {
  it('is true for the same cards unchanged, in any order', () => {
    expect(sameCards([at('a'), at('b')], [at('b'), at('a')])).toBe(true);
    expect(sameCards([], [])).toBe(true);
  });

  it('is false when a card came, went or changed', () => {
    expect(sameCards([], [at('a')])).toBe(false);
    expect(sameCards([at('a'), at('b')], [at('a')])).toBe(false);
    expect(sameCards([at('a')], [at('b')])).toBe(false);
    expect(sameCards([at('a')], [at('a', '2026-11-23T10:00:00.001Z')])).toBe(false);
  });
});

describe('decisionOf', () => {
  const candidates = [at('first'), at('second')];

  it('takes the numbered candidate, counted from 1, as the duplicate', () => {
    expect(decisionOf(candidates, 2)).toEqual({ kind: 'duplicate', cardId: 'second' });
  });

  it('makes a new card for 0 or a number past the candidates', () => {
    expect(decisionOf(candidates, 0)).toEqual({ kind: 'create' });
    expect(decisionOf(candidates, 3)).toEqual({ kind: 'create' });
    expect(decisionOf([], 1)).toEqual({ kind: 'create' });
  });
});

describe('missingIds', () => {
  it('lists the requested IDs not found, in the order requested', () => {
    expect(missingIds(['c', 'a', 'b'], ['a'])).toEqual(['c', 'b']);
    expect(missingIds(['a'], ['a', 'z'])).toEqual([]);
  });
});

describe('changedSelection', () => {
  it('adds IDs once and takes them away', () => {
    expect(changedSelection(['a'], ['a', 'b'], true)).toEqual(['a', 'b']);
    expect(changedSelection(['a', 'b', 'c'], ['b', 'x'], false)).toEqual(['a', 'c']);
  });

  it('refuses an addition that would go over the limit, and allows one that reaches it', () => {
    const full = Array.from({ length: SELECTION_MAX }, (_, index) => `id${index}`);
    expect(changedSelection(full.slice(1), ['id0'], true)).toHaveLength(SELECTION_MAX);
    expect(changedSelection(full, ['one more'], true)).toBeNull();
    expect(changedSelection(full, ['id5'], true)).toHaveLength(SELECTION_MAX);
  });
});
