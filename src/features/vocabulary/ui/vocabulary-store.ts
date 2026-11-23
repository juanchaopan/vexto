'use client';

// The state of the Vocabulary screen that outlives the screen (.docs/design/screens.md, Vocabulary
// and 列表的分批加载): the tab, search, round filters and sort; selection mode and the chosen
// cards; and where the list was when a card was opened, so closing card details restores the
// scroll position. Coming in any other way starts over: no search, Word ascending, one batch and
// no selection, with the tab and the round filters kept.
import { create } from 'zustand';
import { DEFAULT_VOCABULARY_QUERY, type VocabularyQuery } from '../domain/vocabulary-query.ts';

type VocabularyListState = {
  query: VocabularyQuery;
  /** Whether selection mode is on. */
  selecting: boolean;
  /** The chosen cards, in the order they were chosen. */
  selected: string[];
  /** The list's scroll position when a card was opened. */
  scrollY: number;
};

export const useVocabularyStore = create<VocabularyListState>(() => ({
  query: DEFAULT_VOCABULARY_QUERY,
  selecting: false,
  selected: [],
  scrollY: 0,
}));

/** The query a fresh visit starts with: no search and Word ascending, the tab and filters kept. */
export function startOver(): VocabularyQuery {
  const { query } = useVocabularyStore.getState();
  const fresh = {
    ...query,
    q: DEFAULT_VOCABULARY_QUERY.q,
    sort: DEFAULT_VOCABULARY_QUERY.sort,
    direction: DEFAULT_VOCABULARY_QUERY.direction,
  };
  useVocabularyStore.setState({ query: fresh, selecting: false, selected: [], scrollY: 0 });
  return fresh;
}

/** Remembers where the list was as a card is opened. */
export function rememberScroll(): void {
  useVocabularyStore.setState({ scrollY: window.scrollY });
}

export function setSelection(selecting: boolean, selected: string[] = []): void {
  useVocabularyStore.setState({ selecting, selected });
}
