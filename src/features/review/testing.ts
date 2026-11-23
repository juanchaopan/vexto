// Test kit for the reviews. Only test files import this module.
//
// - insertReviewCard(): a card of the member's written straight to the vocabulary tables, with
//   two examples, four Translate options (the right one second) and progress in each mode, so a
//   test reaches any review state without saving through the AI.
// - minutesFromNow(): a due time relative to the present, for progress set by hand.
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../lib/db/client.ts';
import { sha256Hex } from '../../lib/digest.ts';
import { findTargetRanges, lemmaKey, type PartOfSpeech } from '../lookup/index.ts';
import {
  REVIEW_MODES,
  reviewProgress,
  translationSets,
  vocabularyCards,
  vocabularyExamples,
  type ReviewMode,
} from '../vocabulary/index.ts';

export type ModeSeed = { round: number; dueAt: Date | null };

export type ReviewCardSeed = {
  lemma?: string;
  pos?: PartOfSpeech;
  meaningZh?: string;
  acceptedForms?: string[];
  examples?: string[];
  /** Progress by mode; a mode left out is a new word. */
  progress?: Partial<Record<ReviewMode, ModeSeed>>;
  createdAt?: Date;
};

export type ReviewCard = {
  id: string;
  lemma: string;
  meaningZh: string;
  examples: { id: string; text: string }[];
  options: { id: string; pos: string; meaningZh: string }[];
  correctOptionId: string;
};

/** The wrong Translate options of every card the kit writes. */
export const WRONG_MEANINGS = ['持久的；持续很久的', '准确的；精确的', '脆弱的；易受损的'];

/** A made-up word no other test uses, so tests on the shared database never meet. */
export function uniqueWord(): string {
  return `quel${randomUUID().replaceAll('-', '').slice(0, 10)}`;
}

/** A moment this many minutes from now; negative for the past. */
export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function optionsOf(pos: string, meaningZh: string) {
  const meanings = [WRONG_MEANINGS[0], meaningZh, WRONG_MEANINGS[1], WRONG_MEANINGS[2]];
  return meanings.map((meaning) => ({ id: randomUUID(), pos, meaningZh: meaning }));
}

/** A card of the member's with its examples, options and progress. */
export async function insertReviewCard(
  ownerId: string,
  seed: ReviewCardSeed = {},
): Promise<ReviewCard> {
  const db = getDatabase();
  const lemma = seed.lemma ?? uniqueWord();
  const pos = seed.pos ?? 'adjective';
  const meaningZh = seed.meaningZh ?? '有适应力的；能迅速恢复的';
  const acceptedForms = seed.acceptedForms ?? [lemma];
  const texts = seed.examples ?? [
    `A ${lemma} city can adapt to unexpected challenges.`,
    `She remained ${lemma} during a difficult first year abroad.`,
  ];
  const [card] = await db
    .insert(vocabularyCards)
    .values({
      ownerId,
      lemma,
      lemmaKey: lemmaKey(lemma),
      pos,
      meaningZh,
      acceptedForms,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    })
    .returning({ id: vocabularyCards.id });
  const examples = await db
    .insert(vocabularyExamples)
    .values(
      texts.map((text, position) => ({
        cardId: card.id,
        position,
        text,
        targetRanges: findTargetRanges(text, acceptedForms),
        contentHash: sha256Hex(text),
      })),
    )
    .returning({ id: vocabularyExamples.id, text: vocabularyExamples.text });
  const options = optionsOf(pos, meaningZh);
  await db
    .insert(translationSets)
    .values({ cardId: card.id, options, correctOptionId: options[1].id });
  await db.insert(reviewProgress).values(
    REVIEW_MODES.map((mode) => ({
      ownerId,
      cardId: card.id,
      mode,
      round: seed.progress?.[mode]?.round ?? 0,
      dueAt: seed.progress?.[mode]?.dueAt ?? null,
    })),
  );
  return { id: card.id, lemma, meaningZh, examples, options, correctOptionId: options[1].id };
}
