// What a playback locator plays, for the member asking (.docs/design/rules.md, 权限和数据隔离): a
// ready article's audio, which everyone shares, or the text of the member's own lookup or card,
// or of one of its examples. An example is found only through its lookup or card, whose owner is
// checked. Anything missing, not ready or another member's is NOT_FOUND, the same in every case.
import { and, eq } from 'drizzle-orm';
import { ApiError } from '../../../lib/api/errors.ts';
import type { Executor } from '../../../lib/db/client.ts';
import { articles } from '../../articles/index.ts';
import { audioAssets } from '../../audio/index.ts';
import { examples, lookupEntries } from '../../lookup/index.ts';
import type { PlayableAudio, SpeechUsageKind } from '../../playback/index.ts';
import { vocabularyCards, vocabularyExamples } from '../../vocabulary/index.ts';
import { speechUsageKindOf, type PlaybackLocator, type SpeechLocator } from '../domain/locator.ts';

export type PlaybackSource =
  | { kind: 'audio'; audio: PlayableAudio }
  | { kind: 'speech'; text: string; usageKind: SpeechUsageKind };

async function articleAudio(executor: Executor, articleId: string) {
  const [row] = await executor
    .select({ objectKey: audioAssets.objectKey, durationMs: audioAssets.durationMs })
    .from(articles)
    .innerJoin(audioAssets, eq(audioAssets.id, articles.audioAssetId))
    .where(
      and(eq(articles.id, articleId), eq(articles.state, 'ready'), eq(audioAssets.state, 'ready')),
    );
  return row?.durationMs ? { objectKey: row.objectKey, durationMs: row.durationMs } : undefined;
}

async function lookupWord(executor: Executor, ownerId: string, lookupId: string) {
  const [row] = await executor
    .select({ text: lookupEntries.lemma })
    .from(lookupEntries)
    .where(and(eq(lookupEntries.id, lookupId), eq(lookupEntries.ownerId, ownerId)));
  return row?.text;
}

async function lookupExample(
  executor: Executor,
  ownerId: string,
  lookupId: string,
  exampleId: string,
) {
  const [row] = await executor
    .select({ text: examples.text })
    .from(examples)
    .innerJoin(lookupEntries, eq(lookupEntries.id, examples.lookupEntryId))
    .where(
      and(
        eq(examples.id, exampleId),
        eq(examples.lookupEntryId, lookupId),
        eq(lookupEntries.ownerId, ownerId),
      ),
    );
  return row?.text;
}

async function cardWord(executor: Executor, ownerId: string, cardId: string) {
  const [row] = await executor
    .select({ text: vocabularyCards.lemma })
    .from(vocabularyCards)
    .where(and(eq(vocabularyCards.id, cardId), eq(vocabularyCards.ownerId, ownerId)));
  return row?.text;
}

async function cardExample(executor: Executor, ownerId: string, cardId: string, exampleId: string) {
  const [row] = await executor
    .select({ text: vocabularyExamples.text })
    .from(vocabularyExamples)
    .innerJoin(vocabularyCards, eq(vocabularyCards.id, vocabularyExamples.cardId))
    .where(
      and(
        eq(vocabularyExamples.id, exampleId),
        eq(vocabularyExamples.cardId, cardId),
        eq(vocabularyCards.ownerId, ownerId),
      ),
    );
  return row?.text;
}

function speechText(executor: Executor, ownerId: string, locator: SpeechLocator) {
  switch (locator.kind) {
    case 'lookup-word':
      return lookupWord(executor, ownerId, locator.lookupId);
    case 'lookup-example':
      return lookupExample(executor, ownerId, locator.lookupId, locator.exampleId);
    case 'card-word':
      return cardWord(executor, ownerId, locator.cardId);
    case 'card-example':
      return cardExample(executor, ownerId, locator.cardId, locator.exampleId);
  }
}

const notFound = () => new ApiError('NOT_FOUND', 'Nothing to play was found.');

/** The audio or text the locator plays for this member; NOT_FOUND when there is none. */
export async function playbackSource(
  executor: Executor,
  ownerId: string,
  locator: PlaybackLocator,
): Promise<PlaybackSource> {
  if (locator.kind === 'article') {
    const audio = await articleAudio(executor, locator.articleId);
    if (!audio) {
      throw notFound();
    }
    return { kind: 'audio', audio };
  }
  const text = await speechText(executor, ownerId, locator);
  if (text === undefined) {
    throw notFound();
  }
  return { kind: 'speech', text, usageKind: speechUsageKindOf(locator.kind) };
}
