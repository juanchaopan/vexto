// The review progress of a card (.docs/design/data.md, review_progress): one row per mode, each
// with the round of its next answer and when it is due. The progress belongs to the card it
// schedules, so the vocabulary keeps the rows; the review feature moves them on as answers come.

/** The three review modes; each card has one progress row per mode. */
export const REVIEW_MODES = ['speak', 'spell', 'translate'] as const;

export type ReviewMode = (typeof REVIEW_MODES)[number];

/** Round 0 is a new word; reaching this round completes the mode. */
export const FINAL_ROUND = 7;

/** One mode's progress as the interface sends it: the round and the due time, ISO or null. */
export type ModeProgress = { round: number; dueAt: string | null };

export type CardProgress = Record<ReviewMode, ModeProgress>;

/** The progress a new card starts with in every mode: round 0, not due. */
export function newProgress(): ModeProgress {
  return { round: 0, dueAt: null };
}

/** A new card's progress: every mode at round 0, not due. */
export function newCardProgress(): CardProgress {
  return { speak: newProgress(), spell: newProgress(), translate: newProgress() };
}

/**
 * What a card shows for a mode (.docs/design/interfaces.md, 词卡列表): the round of the next
 * answer, `Round <round + 1>`, or `Complete` once the final round is reached.
 */
export function roundLabel(round: number): string {
  return round >= FINAL_ROUND ? 'Complete' : `Round ${round + 1}`;
}
