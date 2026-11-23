// The schedule of reviews (.docs/design/rules.md, 间隔复习): each mode of a card has its own
// round and due time. A right answer moves the mode one round on and waits 1, 2, 4, 7, 15 or 30
// days on reaching rounds 1 to 6; reaching round 7 completes the mode, which has no due time and
// is never asked again. A wrong answer moves one round back, never below 0, and asks again in 10
// minutes. A day is 24 hours, not a calendar day. A mode can be answered while it is a new word
// (round 0 and no due time) or once its due time has come; anything else is answered elsewhere
// already, and a second answer is refused. A card is archived once all three modes are complete;
// the vocabulary derives that from the progress, so answering writes nothing else.

/** The modes that have reviews in this version; Speak keeps its progress but asks nothing. */
export const REVIEWABLE_MODES = ['spell', 'translate'] as const;

export type ReviewableMode = (typeof REVIEWABLE_MODES)[number];

/** Days to wait on reaching round 1, 2, 3, 4, 5 and 6, in that order. */
export const ROUND_WAIT_DAYS = [1, 2, 4, 7, 15, 30] as const;

/** Reaching this round completes the mode: the round after the last wait. */
export const COMPLETE_ROUND = ROUND_WAIT_DAYS.length + 1;

/** Minutes until a wrongly answered question comes back. */
export const RETRY_WAIT_MINUTES = 10;

export type Wait = { unit: 'day' | 'minute'; amount: number };

/** One mode's progress: the round of the last right answers and when it is due, if ever. */
export type Progress = { round: number; dueAt: Date | null };

/** Where an answer takes a mode: its new round and how long until it is due, or never. */
export type Step = { round: number; wait: Wait | null };

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The wait on reaching a round by a right answer; null once the round completes the mode. */
export function waitToReach(round: number): Wait | null {
  if (round >= COMPLETE_ROUND) {
    return null;
  }
  return { unit: 'day', amount: ROUND_WAIT_DAYS[Math.max(1, round) - 1] };
}

/** The round and wait after an answer given at `round`. */
export function stepAfter(round: number, correct: boolean): Step {
  if (!correct) {
    return {
      round: Math.max(0, round - 1),
      wait: { unit: 'minute', amount: RETRY_WAIT_MINUTES },
    };
  }
  const next = Math.min(round + 1, COMPLETE_ROUND);
  return { round: next, wait: waitToReach(next) };
}

/** The due time a wait gives from `now`, or null for no wait. */
export function dueAfter(now: Date, wait: Wait | null): Date | null {
  if (!wait) {
    return null;
  }
  const unit = wait.unit === 'day' ? DAY_MS : MINUTE_MS;
  return new Date(now.getTime() + wait.amount * unit);
}

/** A word never answered in this mode: round 0 with no due time. */
export function isNewWord(progress: Progress): boolean {
  return progress.round === 0 && progress.dueAt === null;
}

/** Whether the mode can be answered at `now`: a new word, or due and not complete. */
export function isAnswerable(progress: Progress, now: Date): boolean {
  if (progress.round >= COMPLETE_ROUND) {
    return false;
  }
  if (progress.dueAt === null) {
    return isNewWord(progress);
  }
  return progress.dueAt.getTime() <= now.getTime();
}
