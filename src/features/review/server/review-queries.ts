// What the reviews read from a member's vocabulary (.docs/design/rules.md, 出题 and 计数), always
// through the member's own progress rows and cards. A mode's next question is the card due
// earliest (by due time, then card ID), and only when nothing is due the oldest new word (by the
// card's creation time, then ID). The counts are, per mode, the questions due now and the new
// words. "Now" is the database's time, so every device and server agrees on what is due.
import { and, asc, eq, gt, inArray, isNull, lt, lte, min, sql } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import {
  FINAL_ROUND,
  reviewProgress,
  translationSets,
  vocabularyCards,
  type TranslationOption,
} from '../../vocabulary/index.ts';
import { REVIEWABLE_MODES, type ReviewableMode } from '../domain/schedule.ts';

const now = sql`now()`;

function ownProgress(ownerId: string, mode: ReviewableMode) {
  return and(eq(reviewProgress.ownerId, ownerId), eq(reviewProgress.mode, mode));
}

const unfinished = lt(reviewProgress.round, FINAL_ROUND);
const isDue = and(unfinished, lte(reviewProgress.dueAt, now));
const isNew = and(eq(reviewProgress.round, 0), isNull(reviewProgress.dueAt));

async function dueCardId(executor: Executor, ownerId: string, mode: ReviewableMode) {
  const [row] = await executor
    .select({ cardId: reviewProgress.cardId })
    .from(reviewProgress)
    .where(and(ownProgress(ownerId, mode), isDue))
    .orderBy(asc(reviewProgress.dueAt), asc(reviewProgress.cardId))
    .limit(1);
  return row?.cardId ?? null;
}

async function newCardId(executor: Executor, ownerId: string, mode: ReviewableMode) {
  const [row] = await executor
    .select({ cardId: vocabularyCards.id })
    .from(reviewProgress)
    .innerJoin(vocabularyCards, eq(vocabularyCards.id, reviewProgress.cardId))
    .where(and(ownProgress(ownerId, mode), isNew, eq(vocabularyCards.ownerId, ownerId)))
    .orderBy(asc(vocabularyCards.createdAt), asc(vocabularyCards.id))
    .limit(1);
  return row?.cardId ?? null;
}

/** The card of the mode's next question, or null when nothing can be asked. */
export async function nextCardId(
  executor: Executor,
  ownerId: string,
  mode: ReviewableMode,
): Promise<string | null> {
  return (await dueCardId(executor, ownerId, mode)) ?? newCardId(executor, ownerId, mode);
}

/** When the mode's next question falls due, or null when none ever will. */
export async function nextDueAt(
  executor: Executor,
  ownerId: string,
  mode: ReviewableMode,
): Promise<Date | null> {
  const [row] = await executor
    .select({ dueAt: min(reviewProgress.dueAt) })
    .from(reviewProgress)
    .where(and(ownProgress(ownerId, mode), unfinished, gt(reviewProgress.dueAt, now)));
  return row?.dueAt ?? null;
}

export type ModeCounts = { due: number; new: number };

/** The questions due now and the new words of each reviewable mode. */
export async function reviewCounts(
  executor: Executor,
  ownerId: string,
): Promise<Record<ReviewableMode, ModeCounts>> {
  const rows = await executor
    .select({
      mode: reviewProgress.mode,
      due: sql<number>`count(*) filter (where ${isDue})`.mapWith(Number),
      fresh: sql<number>`count(*) filter (where ${isNew})`.mapWith(Number),
    })
    .from(reviewProgress)
    .where(
      and(eq(reviewProgress.ownerId, ownerId), inArray(reviewProgress.mode, [...REVIEWABLE_MODES])),
    )
    .groupBy(reviewProgress.mode);
  const counts = { spell: { due: 0, new: 0 }, translate: { due: 0, new: 0 } };
  for (const row of rows) {
    if (row.mode === 'spell' || row.mode === 'translate') {
      counts[row.mode] = { due: row.due, new: row.fresh };
    }
  }
  return counts;
}

/** A mode's progress with the database's time, held until the transaction ends. */
export type HeldProgress = { round: number; dueAt: Date | null; now: Date };

/**
 * Locks the progress row of the member's card in the mode and reads it with the time of the
 * transaction; undefined when the member has no such card.
 */
export async function holdProgress(
  executor: Executor,
  ownerId: string,
  cardId: string,
  mode: ReviewableMode,
): Promise<HeldProgress | undefined> {
  const [row] = await executor
    .select({
      round: reviewProgress.round,
      dueAt: reviewProgress.dueAt,
      now: sql<Date>`now()`.mapWith(reviewProgress.dueAt),
    })
    .from(reviewProgress)
    .innerJoin(vocabularyCards, eq(vocabularyCards.id, reviewProgress.cardId))
    .where(
      and(
        ownProgress(ownerId, mode),
        eq(reviewProgress.cardId, cardId),
        eq(vocabularyCards.ownerId, ownerId),
      ),
    )
    .for('update', { of: reviewProgress });
  return row;
}

/** Moves the mode of the member's card to its new round and due time. */
export async function moveProgress(
  executor: Executor,
  ownerId: string,
  cardId: string,
  mode: ReviewableMode,
  progress: { round: number; dueAt: Date | null },
): Promise<void> {
  await executor
    .update(reviewProgress)
    .set(progress)
    .where(and(ownProgress(ownerId, mode), eq(reviewProgress.cardId, cardId)));
}

/** The card's fields a question is made from, or undefined when the member has no such card. */
export async function questionCard(executor: Executor, ownerId: string, cardId: string) {
  const [card] = await executor
    .select({
      id: vocabularyCards.id,
      lemma: vocabularyCards.lemma,
      pos: vocabularyCards.pos,
      meaningZh: vocabularyCards.meaningZh,
      acceptedForms: vocabularyCards.acceptedForms,
    })
    .from(vocabularyCards)
    .where(and(eq(vocabularyCards.id, cardId), eq(vocabularyCards.ownerId, ownerId)));
  return card;
}

export type QuestionCard = NonNullable<Awaited<ReturnType<typeof questionCard>>>;

/** The card's Translate options in their fixed order and the right one's ID. */
export async function translationOptions(
  executor: Executor,
  cardId: string,
): Promise<{ options: TranslationOption[]; correctOptionId: string } | undefined> {
  const [set] = await executor
    .select({ options: translationSets.options, correctOptionId: translationSets.correctOptionId })
    .from(translationSets)
    .where(eq(translationSets.cardId, cardId));
  return set;
}

/** The round of the card's mode, or undefined when there is no progress row. */
export async function modeRound(
  executor: Executor,
  ownerId: string,
  cardId: string,
  mode: ReviewableMode,
): Promise<number | undefined> {
  const [row] = await executor
    .select({ round: reviewProgress.round })
    .from(reviewProgress)
    .where(and(ownProgress(ownerId, mode), eq(reviewProgress.cardId, cardId)));
  return row?.round;
}
