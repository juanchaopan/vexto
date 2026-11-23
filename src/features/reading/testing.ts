// Rows a test of the article list and the reader reads: ready articles with their sentences, a
// timeline and ready audio, members and their visits. Every helper takes the database to write,
// so a test file can use a database of its own (collection testing's isolatedDatabase()) and know
// every article in it. Only test files import this module.
import { randomInt, randomUUID } from 'node:crypto';
import type { Executor } from '../../lib/db/client.ts';
import { members } from '../../lib/db/schema.ts';
import { articles, articleSentences, visits } from '../articles/index.ts';
import { audioAssets } from '../audio/index.ts';

export type ArticleSeed = {
  title?: string;
  feedKey?: string;
  categoryKey?: string;
  author?: string | null;
  /** Paragraphs of sentences; one short paragraph by default. */
  paragraphs?: string[][];
  collectedAt?: Date;
  state?: 'ready' | 'preparing' | 'failed';
  /** The audio row's state; `ready` by default. */
  audioState?: 'ready' | 'pending' | 'retiring';
};

/** Milliseconds of audio each character of a sentence lasts, and the pause after a sentence. */
export const MS_PER_CHARACTER = 50;
export const SENTENCE_GAP_MS = 300;

/**
 * A made-up word of lower-case letters no other test uses, so a full-text search finds only the
 * article that holds it, among the rows of test files running side by side.
 */
export function uniqueWord(): string {
  return `zq${Array.from({ length: 12 }, () => String.fromCharCode(97 + randomInt(26))).join('')}`;
}

function timeline(texts: readonly string[]) {
  let at = 0;
  return texts.map((text) => {
    const startMs = at;
    const endMs = startMs + text.length * MS_PER_CHARACTER;
    at = endMs + SENTENCE_GAP_MS;
    return { startMs, endMs };
  });
}

function sentenceRows(paragraphs: readonly string[][]) {
  const rows: { paragraphIndex: number; text: string; bodyStart: number; bodyEnd: number }[] = [];
  let body = '';
  paragraphs.forEach((paragraph, paragraphIndex) => {
    paragraph.forEach((text, index) => {
      if (body !== '') {
        body += index === 0 ? '\n\n' : ' ';
      }
      rows.push({
        paragraphIndex,
        text,
        bodyStart: body.length,
        bodyEnd: body.length + text.length,
      });
      body += text;
    });
  });
  return { body, rows };
}

async function insertAudio(
  executor: Executor,
  durationMs: number,
  state: ArticleSeed['audioState'],
) {
  const audioId = randomUUID();
  const objectKey = `articles/${audioId}.mp3`;
  await executor.insert(audioAssets).values({
    id: audioId,
    cacheKey: randomUUID(),
    objectKey,
    state: state ?? 'ready',
    byteSize: 4 * durationMs,
    durationMs,
    voice: 'F1',
    modelRevision: 'test-revision',
    encoding: 'mp3-mono-32k-test',
  });
  return { audioId, objectKey };
}

function articleRow(seed: ArticleSeed, body: string, audioId: string) {
  const state = seed.state ?? 'ready';
  const ready = state === 'ready';
  return {
    feedKey: seed.feedKey ?? 'nasa-technology',
    categoryKey: seed.categoryKey ?? 'technology',
    sourceUrl: `https://news.example.org/${audioId}`,
    title: seed.title ?? `Article ${audioId.slice(0, 8)}`,
    author: seed.author ?? null,
    bodyText: body,
    bodyHash: randomUUID(),
    state,
    audioAssetId: ready ? audioId : null,
    collectedAt: ready ? (seed.collectedAt ?? new Date()) : null,
    retryAt: state === 'preparing' ? new Date() : null,
  };
}

/** Inserts an article, ready with ready audio unless said otherwise. */
export async function insertArticle(executor: Executor, seed: ArticleSeed = {}) {
  const paragraphs = seed.paragraphs ?? [[`A sentence about ${uniqueWord()}.`, 'A second one.']];
  const { body, rows } = sentenceRows(paragraphs);
  const timings = timeline(rows.map((row) => row.text));
  const durationMs = (timings.at(-1)?.endMs ?? 0) + SENTENCE_GAP_MS;
  const { audioId, objectKey } = await insertAudio(executor, durationMs, seed.audioState);
  const row = articleRow(seed, body, audioId);
  const [article] = await executor.insert(articles).values(row).returning({ id: articles.id });
  const timed = row.state === 'ready';
  await executor.insert(articleSentences).values(
    rows.map((sentence, index) => ({
      articleId: article.id,
      sentenceIndex: index,
      ...sentence,
      ...(timed ? timings[index] : { startMs: null, endMs: null }),
    })),
  );
  return { id: article.id, audioId, objectKey, durationMs, timings, body };
}

/** Inserts an active member who accepted the terms, for a database of the test's own. */
export async function insertMember(executor: Executor): Promise<string> {
  const [member] = await executor
    .insert(members)
    .values({
      email: `reader-${randomUUID()}@example.com`,
      status: 'active',
      termsVersion: 1,
      termsAcceptedAt: new Date(),
    })
    .returning({ id: members.id });
  return member.id;
}

/** Records a visit of the member at a given time. */
export async function insertVisit(
  executor: Executor,
  ownerId: string,
  articleId: string,
  at: Date,
): Promise<void> {
  await executor.insert(visits).values({ ownerId, articleId, lastOpenedAt: at });
}
