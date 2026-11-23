// Rows a playback test plays: a ready article with its audio, and a member's lookup and card,
// each with one example. The texts carry a tag of their own, so test files running side by side
// never share a word's cache key. Only test files import this module.
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../lib/db/client.ts';
import { articles } from '../articles/index.ts';
import { audioAssets } from '../audio/index.ts';
import { examples, lookupEntries, type TargetRange } from '../lookup/index.ts';
import { vocabularyCards, vocabularyExamples } from '../vocabulary/index.ts';

const meaning = { pos: 'phrasal verb' as const, meaningZh: '出发', acceptedForms: ['set off'] };

function exampleColumns(text: string) {
  const targetRanges: TargetRange[] = [[0, 4]];
  return { position: 0, text, targetRanges, contentHash: randomUUID() };
}

function tag() {
  return randomUUID().slice(0, 8);
}

export type SpeechRowOptions = {
  /** The lemma; a tagged one by default. */
  lemma?: string;
};

/** A lookup of the member's with one example, whose text has a double space in it. */
export async function createLookup(ownerId: string, options: SpeechRowOptions = {}) {
  const lemma = options.lemma ?? `take off ${tag()}`;
  const [lookup] = await getDatabase()
    .insert(lookupEntries)
    .values({
      ownerId,
      contextText: `The plane will ${lemma} soon.`,
      contextHash: randomUUID(),
      selectionStart: 15,
      selectionEnd: 15 + lemma.length,
      selectedText: lemma,
      lemma,
      lemmaKey: lemma,
      ...meaning,
    })
    .returning({ id: lookupEntries.id });
  const exampleText = `Planes  ${lemma} at dawn.`;
  const [example] = await getDatabase()
    .insert(examples)
    .values({ lookupEntryId: lookup.id, ...exampleColumns(exampleText) })
    .returning({ id: examples.id });
  return { lookupId: lookup.id, exampleId: example.id, lemma, exampleText };
}

/** A vocabulary card of the member's with one example. */
export async function createCard(ownerId: string, options: SpeechRowOptions = {}) {
  const lemma = options.lemma ?? `set off ${tag()}`;
  const [card] = await getDatabase()
    .insert(vocabularyCards)
    .values({ ownerId, lemma, lemmaKey: lemma, ...meaning })
    .returning({ id: vocabularyCards.id });
  const exampleText = `They ${lemma} before sunrise.`;
  const [example] = await getDatabase()
    .insert(vocabularyExamples)
    .values({ cardId: card.id, ...exampleColumns(exampleText) })
    .returning({ id: vocabularyExamples.id });
  return { cardId: card.id, exampleId: example.id, lemma, exampleText };
}

/** An article with its ready audio, ready itself unless said otherwise. */
export async function createArticle(state: 'ready' | 'preparing' = 'ready') {
  const audioId = randomUUID();
  const objectKey = `articles/${audioId}.mp3`;
  await getDatabase().insert(audioAssets).values({
    id: audioId,
    cacheKey: randomUUID(),
    objectKey,
    state: 'ready',
    byteSize: 120_000,
    durationMs: 30_000,
    voice: 'F1',
    modelRevision: 'test-revision',
    encoding: 'mp3-mono-32k-test',
  });
  const ready = state === 'ready';
  const [article] = await getDatabase()
    .insert(articles)
    .values({
      feedKey: 'nasa-technology',
      categoryKey: 'technology',
      sourceUrl: `https://news.example.org/${audioId}`,
      title: 'Played',
      bodyText: 'One sentence.',
      bodyHash: randomUUID(),
      state,
      audioAssetId: ready ? audioId : null,
      collectedAt: ready ? new Date() : null,
      retryAt: ready ? null : new Date(),
    })
    .returning({ id: articles.id });
  return { articleId: article.id, objectKey, durationMs: 30_000 };
}
