// What the Vocabulary list shows (.docs/design/rules.md, 列表): a state tab, a search, a round
// filter for each mode and one sort in one direction. A card's state comes from its three
// progress rows; Round n of a filter is the round of the next answer, so it matches round n − 1,
// and Complete matches the final round.
import { FINAL_ROUND, REVIEW_MODES, type ReviewMode } from './review-progress.ts';

export const VOCABULARY_STATES = ['all', 'new', 'ongoing', 'archived'] as const;

export type VocabularyState = (typeof VOCABULARY_STATES)[number];

export const VOCABULARY_SORTS = [
  'word',
  'speakRound',
  'speakNext',
  'spellRound',
  'spellNext',
  'translateRound',
  'translateNext',
] as const;

export type VocabularySort = (typeof VOCABULARY_SORTS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** The choices of a round filter: Round 1 to Round 7 and Complete. */
export const ROUND_CHOICES = ['1', '2', '3', '4', '5', '6', '7', 'complete'] as const;

export type RoundChoice = (typeof ROUND_CHOICES)[number];

/** The search box takes no more characters than this. */
export const VOCABULARY_SEARCH_MAX_LENGTH = 100;

export type RoundFilters = Record<ReviewMode, RoundChoice[]>;

export type VocabularyQuery = {
  state: VocabularyState;
  /** Text a card's lemma, meaning, part of speech or examples contain; empty for no search. */
  q: string;
  /** For each mode the chosen rounds, any of which matches; empty for every round. */
  rounds: RoundFilters;
  sort: VocabularySort;
  direction: SortDirection;
};

export const NO_ROUND_FILTERS: RoundFilters = { speak: [], spell: [], translate: [] };

/** Every card, by word A to Z. */
export const DEFAULT_VOCABULARY_QUERY: VocabularyQuery = {
  state: 'all',
  q: '',
  rounds: NO_ROUND_FILTERS,
  sort: 'word',
  direction: 'asc',
};

/**
 * The choices a round filter keeps, in the order of the options. Choosing every round is the
 * same as choosing none, so it comes out empty, and a value that is not a choice is dropped.
 */
export function effectiveRounds(selected: readonly string[]): RoundChoice[] {
  const kept = ROUND_CHOICES.filter((choice) => selected.includes(choice));
  return kept.length === ROUND_CHOICES.length ? [] : kept;
}

/** The progress rounds the chosen filter matches: Round n is round n − 1, Complete the last. */
export function roundsOfChoices(choices: readonly RoundChoice[]): number[] {
  return choices.map((choice) => (choice === 'complete' ? FINAL_ROUND : Number(choice) - 1));
}

/** What a sort orders by: the word, or one mode's round or next due time. */
export type SortKey = { kind: 'word' } | { kind: 'round' | 'next'; mode: ReviewMode };

export function sortKeyOf(sort: VocabularySort): SortKey {
  for (const mode of REVIEW_MODES) {
    if (sort === `${mode}Round`) {
      return { kind: 'round', mode };
    }
    if (sort === `${mode}Next`) {
      return { kind: 'next', mode };
    }
  }
  return { kind: 'word' };
}

/** True when a tab other than All, a search or a filter narrows the list. */
export function isNarrowed(query: VocabularyQuery): boolean {
  return (
    query.state !== 'all' ||
    query.q !== '' ||
    REVIEW_MODES.some((mode) => query.rounds[mode].length > 0)
  );
}

/**
 * A pattern for `ILIKE … ESCAPE '\'` that matches text containing the search as it is: the
 * escape character and the wildcards `%` and `_` of the search match only themselves.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
