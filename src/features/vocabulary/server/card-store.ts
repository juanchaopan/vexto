// Reading and writing a member's cards (.docs/design/data.md, 生词本). Every read goes through the
// card's owner, so another member's card is not there. Saving, replacing and deleting first hold
// the member's row (`SELECT … FOR UPDATE`), so one member's writes to the vocabulary take turns.
//
// `updated_at` is kept to whole milliseconds and always moves forward, so the time the interface
// sends back with a replacement compares equal to the stored one exactly when nothing changed.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { ApiError } from '../../../lib/api/errors.ts';
import type { Executor, Transaction } from '../../../lib/db/client.ts';
import { isoOrNull } from '../../../lib/db/columns.ts';
import { members } from '../../../lib/db/schema.ts';
import { sha256Hex } from '../../../lib/digest.ts';
import {
  examples,
  lookupEntries,
  type PartOfSpeech,
  type TargetRange,
} from '../../lookup/index.ts';
import {
  newCardProgress,
  REVIEW_MODES,
  type CardProgress,
  type ModeProgress,
} from '../domain/review-progress.ts';
import type { CardStamp } from '../domain/save-decision.ts';
import type { TranslationSet } from '../domain/translation-set.ts';
import { reviewProgress, translationSets, vocabularyCards, vocabularyExamples } from './schema.ts';

export type CardExampleView = {
  id: string;
  position: number;
  text: string;
  targetRanges: TargetRange[];
};

/** A card as `GET /api/vocabulary/:id` answers it. */
export type CardView = {
  id: string;
  lemma: string;
  pos: PartOfSpeech;
  meaningZh: string;
  progress: CardProgress;
  updatedAt: string;
  examples: CardExampleView[];
};

/** The saved card a DUPLICATE_WORD answer carries (.docs/design/interfaces.md, 错误). */
export type SavedCard = Omit<CardView, 'progress'>;

/** The next `updated_at`: now in whole milliseconds, and later than the one before. */
const nextUpdatedAt = sql`greatest(date_trunc('milliseconds', now()), ${vocabularyCards.updatedAt} + interval '1 millisecond')`;

const exampleView = {
  id: vocabularyExamples.id,
  position: vocabularyExamples.position,
  text: vocabularyExamples.text,
  targetRanges: vocabularyExamples.targetRanges,
};

/** The examples of a card in position order. */
export function cardExamples(executor: Executor, cardId: string): Promise<CardExampleView[]> {
  return executor
    .select(exampleView)
    .from(vocabularyExamples)
    .where(eq(vocabularyExamples.cardId, cardId))
    .orderBy(asc(vocabularyExamples.position));
}

/** The progress of each card, by card ID; a mode without a row shows as new. */
export async function progressOf(
  executor: Executor,
  ownerId: string,
  cardIds: readonly string[],
): Promise<Map<string, CardProgress>> {
  const progress = new Map<string, CardProgress>();
  if (cardIds.length === 0) {
    return progress;
  }
  const rows = await executor
    .select({
      cardId: reviewProgress.cardId,
      mode: reviewProgress.mode,
      round: reviewProgress.round,
      dueAt: reviewProgress.dueAt,
    })
    .from(reviewProgress)
    .where(and(eq(reviewProgress.ownerId, ownerId), inArray(reviewProgress.cardId, [...cardIds])));
  for (const id of cardIds) {
    progress.set(id, newCardProgress());
  }
  for (const row of rows) {
    const mode: ModeProgress = { round: row.round, dueAt: isoOrNull(row.dueAt) };
    const card = progress.get(row.cardId);
    if (card) {
      card[row.mode] = mode;
    }
  }
  return progress;
}

function ownCard(ownerId: string, cardId: string) {
  return and(eq(vocabularyCards.id, cardId), eq(vocabularyCards.ownerId, ownerId));
}

const cardHead = {
  id: vocabularyCards.id,
  lemma: vocabularyCards.lemma,
  lemmaKey: vocabularyCards.lemmaKey,
  pos: vocabularyCards.pos,
  meaningZh: vocabularyCards.meaningZh,
  acceptedForms: vocabularyCards.acceptedForms,
  updatedAt: vocabularyCards.updatedAt,
};

export type CardHead = {
  id: string;
  lemma: string;
  lemmaKey: string;
  pos: PartOfSpeech;
  meaningZh: string;
  acceptedForms: string[];
  updatedAt: string;
};

/**
 * The member's card without its examples and progress, or undefined when there is none. Inside a
 * transaction `lock` holds the card's row until the transaction ends.
 */
export async function cardHeadOf(
  executor: Executor,
  ownerId: string,
  cardId: string,
  lock = false,
): Promise<CardHead | undefined> {
  const query = executor.select(cardHead).from(vocabularyCards).where(ownCard(ownerId, cardId));
  const [row] = lock ? await query.for('update') : await query;
  return row && { ...row, updatedAt: row.updatedAt.toISOString() };
}

/** The member's card as the endpoints answer it, or undefined when there is none. */
export async function readCard(
  executor: Executor,
  ownerId: string,
  cardId: string,
): Promise<CardView | undefined> {
  const head = await cardHeadOf(executor, ownerId, cardId);
  if (!head) {
    return undefined;
  }
  const [progress, cardExampleViews] = await Promise.all([
    progressOf(executor, ownerId, [cardId]),
    cardExamples(executor, cardId),
  ]);
  return {
    id: head.id,
    lemma: head.lemma,
    pos: head.pos,
    meaningZh: head.meaningZh,
    progress: progress.get(cardId) ?? newCardProgress(),
    updatedAt: head.updatedAt,
    examples: cardExampleViews,
  };
}

/** The card's fields a DUPLICATE_WORD answer carries. */
export function savedCardOf(card: CardView): SavedCard {
  return {
    id: card.id,
    lemma: card.lemma,
    pos: card.pos,
    meaningZh: card.meaningZh,
    examples: card.examples,
    updatedAt: card.updatedAt,
  };
}

/** Holds the member's row until the transaction ends, so the member's vocabulary writes take turns. */
export async function lockMember(tx: Transaction, ownerId: string): Promise<void> {
  await tx.select({ id: members.id }).from(members).where(eq(members.id, ownerId)).for('update');
}

/** An explanation of the member's as a card is made from it. */
export type CardSource = {
  id: string;
  lemma: string;
  lemmaKey: string;
  pos: PartOfSpeech;
  meaningZh: string;
  acceptedForms: string[];
  examples: { position: number; text: string; targetRanges: TargetRange[]; contentHash: string }[];
};

/** The member's lookup with its examples, or undefined when there is none. */
export async function cardSourceOf(
  executor: Executor,
  ownerId: string,
  lookupId: string,
): Promise<CardSource | undefined> {
  const [entry] = await executor
    .select({
      id: lookupEntries.id,
      lemma: lookupEntries.lemma,
      lemmaKey: lookupEntries.lemmaKey,
      pos: lookupEntries.pos,
      meaningZh: lookupEntries.meaningZh,
      acceptedForms: lookupEntries.acceptedForms,
    })
    .from(lookupEntries)
    .where(and(eq(lookupEntries.id, lookupId), eq(lookupEntries.ownerId, ownerId)));
  if (!entry) {
    return undefined;
  }
  const rows = await executor
    .select({
      position: examples.position,
      text: examples.text,
      targetRanges: examples.targetRanges,
      contentHash: examples.contentHash,
    })
    .from(examples)
    .where(eq(examples.lookupEntryId, lookupId))
    .orderBy(asc(examples.position));
  return { ...entry, examples: rows };
}

/** The member's cards with this lemma and part of speech, oldest first. */
export async function sameWordCards(
  executor: Executor,
  ownerId: string,
  word: { lemmaKey: string; pos: PartOfSpeech },
): Promise<CardStamp[]> {
  const rows = await executor
    .select({ id: vocabularyCards.id, updatedAt: vocabularyCards.updatedAt })
    .from(vocabularyCards)
    .where(
      and(
        eq(vocabularyCards.ownerId, ownerId),
        eq(vocabularyCards.lemmaKey, word.lemmaKey),
        eq(vocabularyCards.pos, word.pos),
      ),
    )
    .orderBy(asc(vocabularyCards.createdAt), asc(vocabularyCards.id));
  return rows.map((row) => ({ id: row.id, updatedAt: row.updatedAt.toISOString() }));
}

/** The meanings and example texts of the member's cards, in the order of the IDs. */
export async function cardMeanings(
  executor: Executor,
  ownerId: string,
  cardIds: readonly string[],
): Promise<{ meaningZh: string; examples: string[] }[]> {
  if (cardIds.length === 0) {
    return [];
  }
  const owned = and(
    eq(vocabularyCards.ownerId, ownerId),
    inArray(vocabularyCards.id, [...cardIds]),
  );
  const [cards, exampleRows] = await Promise.all([
    executor
      .select({ id: vocabularyCards.id, meaningZh: vocabularyCards.meaningZh })
      .from(vocabularyCards)
      .where(owned),
    executor
      .select({ cardId: vocabularyExamples.cardId, text: vocabularyExamples.text })
      .from(vocabularyExamples)
      .innerJoin(vocabularyCards, eq(vocabularyCards.id, vocabularyExamples.cardId))
      .where(owned)
      .orderBy(asc(vocabularyExamples.position)),
  ]);
  const texts = new Map<string, string[]>();
  for (const row of exampleRows) {
    texts.set(row.cardId, [...(texts.get(row.cardId) ?? []), row.text]);
  }
  const meanings = new Map(cards.map((card) => [card.id, card.meaningZh]));
  return cardIds.flatMap((id) => {
    const meaningZh = meanings.get(id);
    return meaningZh === undefined ? [] : [{ meaningZh, examples: texts.get(id) ?? [] }];
  });
}

function exampleRowsOf(cardId: string, source: CardSource) {
  return source.examples.map((example) => ({ cardId, ...example }));
}

function meaningOf(source: CardSource) {
  return {
    sourceLookupEntryId: source.id,
    lemma: source.lemma,
    lemmaKey: source.lemmaKey,
    pos: source.pos,
    meaningZh: source.meaningZh,
    acceptedForms: source.acceptedForms,
  };
}

/**
 * Makes a card of the explanation: the meaning, a copy of every example with new IDs, the
 * Translate options and a new progress row for each mode. Returns the card's ID.
 */
export async function insertCard(
  tx: Transaction,
  ownerId: string,
  source: CardSource,
  options: TranslationSet,
): Promise<string> {
  const [card] = await tx
    .insert(vocabularyCards)
    .values({ ownerId, ...meaningOf(source), updatedAt: sql`date_trunc('milliseconds', now())` })
    .returning({ id: vocabularyCards.id });
  await tx.insert(vocabularyExamples).values(exampleRowsOf(card.id, source));
  await tx.insert(translationSets).values({ cardId: card.id, ...options });
  await tx
    .insert(reviewProgress)
    .values(
      REVIEW_MODES.map((mode) => ({ ownerId, cardId: card.id, mode, round: 0, dueAt: null })),
    );
  return card.id;
}

/**
 * Puts the explanation's meaning, examples and Translate options on the card; the review progress
 * stays as it is.
 */
export async function replaceCardContent(
  tx: Transaction,
  cardId: string,
  source: CardSource,
  options: TranslationSet,
): Promise<void> {
  await tx
    .update(vocabularyCards)
    .set({ ...meaningOf(source), updatedAt: nextUpdatedAt })
    .where(eq(vocabularyCards.id, cardId));
  await tx.delete(vocabularyExamples).where(eq(vocabularyExamples.cardId, cardId));
  await tx.insert(vocabularyExamples).values(exampleRowsOf(cardId, source));
  await tx
    .insert(translationSets)
    .values({ cardId, ...options })
    .onConflictDoUpdate({
      target: translationSets.cardId,
      set: { options: options.options, correctOptionId: options.correctOptionId },
    });
}

const replaced = () =>
  new ApiError('CONFLICT', 'The example was replaced or its card changed meanwhile.');

/**
 * Puts the new example in the old one's position, with a new ID, and marks the card as changed.
 * The caller holds the card's row; an example that is gone by now, or a new example the card
 * already has, is a CONFLICT.
 */
export async function replaceCardExample(
  tx: Transaction,
  cardId: string,
  exampleId: string,
  example: { text: string; targetRanges: TargetRange[] },
): Promise<CardExampleView> {
  const [old] = await tx
    .delete(vocabularyExamples)
    .where(and(eq(vocabularyExamples.id, exampleId), eq(vocabularyExamples.cardId, cardId)))
    .returning({ position: vocabularyExamples.position });
  if (!old) {
    throw replaced();
  }
  const contentHash = sha256Hex(example.text);
  const [same] = await tx
    .select({ id: vocabularyExamples.id })
    .from(vocabularyExamples)
    .where(
      and(eq(vocabularyExamples.cardId, cardId), eq(vocabularyExamples.contentHash, contentHash)),
    );
  if (same) {
    throw replaced();
  }
  const [inserted] = await tx
    .insert(vocabularyExamples)
    .values({ cardId, position: old.position, ...example, contentHash })
    .returning(exampleView);
  await tx
    .update(vocabularyCards)
    .set({ updatedAt: nextUpdatedAt })
    .where(eq(vocabularyCards.id, cardId));
  return inserted;
}

/** Deletes the member's cards with these IDs, with their examples, options and progress. */
export async function deleteCards(
  tx: Transaction,
  ownerId: string,
  cardIds: readonly string[],
): Promise<string[]> {
  const deleted = await tx
    .delete(vocabularyCards)
    .where(and(eq(vocabularyCards.ownerId, ownerId), inArray(vocabularyCards.id, [...cardIds])))
    .returning({ id: vocabularyCards.id });
  return deleted.map((row) => row.id);
}

/** The IDs among these that are the member's cards. */
export async function ownCardIds(
  executor: Executor,
  ownerId: string,
  cardIds: readonly string[],
): Promise<string[]> {
  const rows = await executor
    .select({ id: vocabularyCards.id })
    .from(vocabularyCards)
    .where(and(eq(vocabularyCards.ownerId, ownerId), inArray(vocabularyCards.id, [...cardIds])));
  return rows.map((row) => row.id);
}
