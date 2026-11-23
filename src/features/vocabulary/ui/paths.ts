// The pages of the vocabulary and the reviews it leads to.
import type { ReviewMode } from '../domain/review-progress.ts';

export const VOCABULARY_PATH = '/vocabulary';

/** The path of a card's details. */
export const cardPath = (id: string) => `${VOCABULARY_PATH}/${encodeURIComponent(id)}`;

/** The path of a mode's review. */
export const reviewPath = (mode: ReviewMode) => `/review/${mode}`;

/** The selector of a card's lemma in the list, where the focus goes back to. */
export const cardTitleSelector = (id: string) =>
  `[data-card-id="${CSS.escape(id)}"] [data-card-title]`;
