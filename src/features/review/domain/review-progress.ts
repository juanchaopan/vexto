/** The three review modes; each card has one progress row per mode. */
export const REVIEW_MODES = ['speak', 'spell', 'translate'] as const;

export type ReviewMode = (typeof REVIEW_MODES)[number];

/** Round 0 is a new word; reaching this round completes the mode. */
export const FINAL_ROUND = 7;
