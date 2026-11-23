// Test kit for the vocabulary. Only test files import this module.
//
// - vocabularyAnswers: default answers of the save tasks for the lookup feature's openAiDouble():
//   the same-meaning check names the first saved meaning written exactly like the new one (0 when
//   none is), and the Translate options are three fixed wrong meanings.
// - insertLookup(): a lookup of the member's with two examples, written straight to the tables,
//   so a save has something to save without asking the AI for an explanation.
// - cardRows(), setProgress(): what a card has in the tables, and its progress set by hand.
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { getDatabase } from '../../lib/db/client.ts';
import { sha256Hex } from '../../lib/digest.ts';
import {
  examples,
  findTargetRanges,
  lemmaKey,
  lookupEntries,
  type PartOfSpeech,
} from '../lookup/index.ts';
import type { ReviewMode } from './domain/review-progress.ts';
import {
  reviewProgress,
  translationSets,
  vocabularyCards,
  vocabularyExamples,
} from './server/schema.ts';

/** The wrong Translate options the double writes. */
export const TEST_DISTRACTORS = ['迅速消失的', '令人厌烦的', '非常昂贵的'];

/** Default answers by the name of the structured output, made from the data a request sent. */
export const vocabularyAnswers: Record<string, (data: Record<string, unknown>) => unknown> = {
  meaning_match(data) {
    const word = data.word as { meaningZh?: string } | undefined;
    const saved = (data.savedMeanings as { number: number; meaningZh: string }[] | undefined) ?? [];
    return { sameMeaning: saved.find((one) => one.meaningZh === word?.meaningZh)?.number ?? 0 };
  },
  translation_options: () => ({ distractors: TEST_DISTRACTORS }),
};

export type LookupSeed = {
  lemma?: string;
  pos?: PartOfSpeech;
  meaningZh?: string;
  /** Two example sentences, each with the lemma in it. */
  examples?: [string, string];
};

/** A made-up word no other test uses, so tests on the shared database never meet. */
export function uniqueLemma(): string {
  return `zorb${randomUUID().replaceAll('-', '').slice(0, 10)}`;
}

/** A lookup of the member's with two examples, as the lookup endpoint would have stored it. */
export async function insertLookup(ownerId: string, seed: LookupSeed = {}) {
  const lemma = seed.lemma ?? uniqueLemma();
  const meaningZh = seed.meaningZh ?? '有韧性的；经得起损耗的';
  const texts = seed.examples ?? [
    `The new coating keeps the camera ${lemma} in harsh desert conditions.`,
    `Engineers tested how ${lemma} the panels stayed after a long winter.`,
  ];
  const context = `A ${lemma} design ${randomUUID()}.`;
  const [entry] = await getDatabase()
    .insert(lookupEntries)
    .values({
      ownerId,
      contextText: context,
      contextHash: sha256Hex(context),
      selectionStart: 2,
      selectionEnd: 2 + lemma.length,
      selectedText: lemma,
      lemma,
      lemmaKey: lemmaKey(lemma),
      pos: seed.pos ?? 'adjective',
      meaningZh,
      acceptedForms: [lemma],
    })
    .returning({ id: lookupEntries.id });
  await getDatabase()
    .insert(examples)
    .values(
      texts.map((text, position) => ({
        lookupEntryId: entry.id,
        position,
        text,
        targetRanges: findTargetRanges(text, [lemma]),
        contentHash: sha256Hex(text),
      })),
    );
  return { lookupId: entry.id, lemma, meaningZh, examples: texts };
}

/** Everything the tables hold for a card: the row, its examples, options and progress. */
export async function cardRows(cardId: string) {
  const db = getDatabase();
  const [card] = await db.select().from(vocabularyCards).where(eq(vocabularyCards.id, cardId));
  const cardExamples = await db
    .select()
    .from(vocabularyExamples)
    .where(eq(vocabularyExamples.cardId, cardId))
    .orderBy(asc(vocabularyExamples.position));
  const [options] = await db
    .select()
    .from(translationSets)
    .where(eq(translationSets.cardId, cardId));
  const progress = await db
    .select()
    .from(reviewProgress)
    .where(eq(reviewProgress.cardId, cardId))
    .orderBy(asc(reviewProgress.mode));
  return { card, examples: cardExamples, options, progress };
}

/** Sets one mode's progress of a card, as answering reviews would have. */
export async function setProgress(
  ownerId: string,
  cardId: string,
  mode: ReviewMode,
  round: number,
  dueAt: Date | null,
): Promise<void> {
  await getDatabase()
    .update(reviewProgress)
    .set({ round, dueAt })
    .where(
      and(
        eq(reviewProgress.ownerId, ownerId),
        eq(reviewProgress.cardId, cardId),
        eq(reviewProgress.mode, mode),
      ),
    );
}
