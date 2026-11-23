// The text a lookup explains its selection in (.docs/design/interfaces.md, 发起查词), rebuilt on
// the server from the context's IDs; the client never sends text. An article context is the slice
// of the article's body from its first sentence's start to its last sentence's end, which the
// reader shows as the same sentences joined by a space or two line feeds. An example context is
// the whole example of the member's own lookup or card. A Spell example also has the ranges its
// question hides, which a selection must stay clear of: the same ranges the question cuts out.
// Anything missing, not ready or another member's is NOT_FOUND, the same in every case.
import { and, asc, between, eq } from 'drizzle-orm';
import { ApiError } from '../../../lib/api/errors.ts';
import type { Executor } from '../../../lib/db/client.ts';
import { articles, articleSentences } from '../../articles/index.ts';
import { spellHiddenRanges } from '../domain/hidden-target.ts';
import type { TargetRange } from '../domain/lookup-entry.ts';
import type { LookupContextLocator } from './lookup-request.ts';
import { examples, lookupEntries } from './schema.ts';

export type ExampleText = { text: string; targetRanges: TargetRange[] };

/** An example of a card, with the forms its card accepts, which a Spell question hides too. */
export type CardExampleText = ExampleText & { acceptedForms: string[] };

/**
 * What lookups need from vocabulary cards, which the vocabulary feature provides: the lookup
 * feature does not reach the cards itself, since the cards are built on lookups.
 */
export type CardSources = {
  /** An example of the member's own card, or undefined when there is none. */
  cardExample(
    executor: Executor,
    ownerId: string,
    cardId: string,
    exampleId: string,
  ): Promise<CardExampleText | undefined>;
  /** The member's card saved from this lookup, or null when there is none. */
  savedCardId(executor: Executor, ownerId: string, lookupId: string): Promise<string | null>;
};

export type LookupContextText = {
  text: string;
  /** Ranges a selection must not overlap: the hidden words of a Spell question. */
  hiddenRanges: TargetRange[];
};

const notFound = () => new ApiError('NOT_FOUND', 'The context of this lookup was not found.');

async function articleContext(
  executor: Executor,
  context: Extract<LookupContextLocator, { kind: 'article' }>,
): Promise<string | undefined> {
  const [article] = await executor
    .select({ bodyText: articles.bodyText })
    .from(articles)
    .where(and(eq(articles.id, context.articleId), eq(articles.state, 'ready')));
  if (!article) {
    return undefined;
  }
  const sentences = await executor
    .select({ bodyStart: articleSentences.bodyStart, bodyEnd: articleSentences.bodyEnd })
    .from(articleSentences)
    .where(
      and(
        eq(articleSentences.articleId, context.articleId),
        between(articleSentences.sentenceIndex, context.firstSentence, context.lastSentence),
      ),
    )
    .orderBy(asc(articleSentences.sentenceIndex));
  if (sentences.length !== context.lastSentence - context.firstSentence + 1) {
    return undefined;
  }
  return article.bodyText.slice(sentences[0].bodyStart, sentences[sentences.length - 1].bodyEnd);
}

/** An example of the member's own lookup, with its target ranges; undefined when there is none. */
export async function lookupExample(
  executor: Executor,
  ownerId: string,
  lookupId: string,
  exampleId: string,
): Promise<ExampleText | undefined> {
  const [row] = await executor
    .select({ text: examples.text, targetRanges: examples.targetRanges })
    .from(examples)
    .innerJoin(lookupEntries, eq(lookupEntries.id, examples.lookupEntryId))
    .where(
      and(
        eq(examples.id, exampleId),
        eq(examples.lookupEntryId, lookupId),
        eq(lookupEntries.ownerId, ownerId),
      ),
    );
  return row;
}

async function exampleContext(
  executor: Executor,
  ownerId: string,
  context: Exclude<LookupContextLocator, { kind: 'article' }>,
  cards: CardSources,
): Promise<LookupContextText | undefined> {
  if (context.kind === 'lookup-example') {
    const example = await lookupExample(executor, ownerId, context.lookupId, context.exampleId);
    return example && { text: example.text, hiddenRanges: [] };
  }
  const example = await cards.cardExample(executor, ownerId, context.cardId, context.exampleId);
  return (
    example && {
      text: example.text,
      hiddenRanges:
        context.kind === 'spell-example'
          ? spellHiddenRanges(example.text, example.targetRanges, example.acceptedForms)
          : [],
    }
  );
}

/** The context text the locator names for this member; NOT_FOUND when there is none. */
export async function lookupContextText(
  executor: Executor,
  ownerId: string,
  context: LookupContextLocator,
  cards: CardSources,
): Promise<LookupContextText> {
  const found =
    context.kind === 'article'
      ? await articleContext(executor, context).then(
          (text) => text && { text, hiddenRanges: [] as TargetRange[] },
        )
      : await exampleContext(executor, ownerId, context, cards);
  if (!found) {
    throw notFound();
  }
  return found;
}
