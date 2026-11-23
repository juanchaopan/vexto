// What lookups read from the member's vocabulary cards (.docs/design/rules.md, 选区和上下文 and
// 缓存): a card's example as the context of a lookup made in card details or a review question,
// and the card saved from a lookup, so an explanation shows it is saved. Each query goes through
// the card's owner; another member's card is not there.
import { and, eq } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import type { CardSources } from '../../lookup/index.ts';
import { vocabularyCards, vocabularyExamples } from './schema.ts';

export const cardSources: CardSources = {
  async cardExample(executor, ownerId, cardId, exampleId) {
    const [row] = await executor
      .select({ text: vocabularyExamples.text, targetRanges: vocabularyExamples.targetRanges })
      .from(vocabularyExamples)
      .innerJoin(vocabularyCards, eq(vocabularyCards.id, vocabularyExamples.cardId))
      .where(
        and(
          eq(vocabularyExamples.id, exampleId),
          eq(vocabularyExamples.cardId, cardId),
          eq(vocabularyCards.ownerId, ownerId),
        ),
      );
    return row;
  },

  async savedCardId(executor: Executor, ownerId: string, lookupId: string) {
    const [row] = await executor
      .select({ id: vocabularyCards.id })
      .from(vocabularyCards)
      .where(
        and(
          eq(vocabularyCards.sourceLookupEntryId, lookupId),
          eq(vocabularyCards.ownerId, ownerId),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  },
};
