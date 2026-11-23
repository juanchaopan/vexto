// The audio row of an article (.docs/design/rules.md, 合成和发布 and 朗读和存储上限). Its
// cache_key is the SHA-256 of `article`, the article ID, the voice, the model revision and the
// encoding, one per line, and its object key is `articles/<audio ID>.mp3`. Among rows that are
// not retiring a cache key is unique, so every attempt at an article's audio uses the one row
// that is waiting for it, and writes the same object.
import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import { sha256Hex } from '../../../lib/digest.ts';
import { audioAssets } from './schema.ts';

/** What an audio was made with, as each audio row records it. */
export type AudioVersion = { voice: string; modelRevision: string; encoding: string };

export function articleAudioCacheKey(articleId: string, version: AudioVersion): string {
  return sha256Hex(
    ['article', articleId, version.voice, version.modelRevision, version.encoding].join('\n'),
  );
}

export function articleAudioObjectKey(audioId: string): string {
  return `articles/${audioId}.mp3`;
}

export type ArticleAudioRow = { id: string; objectKey: string };

/**
 * The predicate of the partial unique index on cache_key, written as a literal: ON CONFLICT
 * finds the index only when its WHERE implies the index's own.
 */
const uniqueAmongLive = sql.raw(`state <> 'retiring'`);

/**
 * The article's audio row that is not retiring: a new `pending` row with a new ID and object key,
 * or the row an earlier attempt left.
 */
export async function articleAudioRow(
  executor: Executor,
  articleId: string,
  version: AudioVersion,
): Promise<ArticleAudioRow> {
  const id = randomUUID();
  const cacheKey = articleAudioCacheKey(articleId, version);
  await executor
    .insert(audioAssets)
    .values({ id, cacheKey, objectKey: articleAudioObjectKey(id), state: 'pending', ...version })
    .onConflictDoNothing({ target: audioAssets.cacheKey, where: uniqueAmongLive });
  const [row] = await executor
    .select({ id: audioAssets.id, objectKey: audioAssets.objectKey })
    .from(audioAssets)
    .where(and(eq(audioAssets.cacheKey, cacheKey), ne(audioAssets.state, 'retiring')));
  return row;
}

/**
 * Marks a pending audio row ready with its size and duration; false when the row is no longer
 * pending, so the caller leaves its transaction without publishing.
 */
export async function markAudioReady(
  executor: Executor,
  audioId: string,
  audio: { byteSize: number; durationMs: number },
): Promise<boolean> {
  const marked = await executor
    .update(audioAssets)
    .set({ state: 'ready', byteSize: audio.byteSize, durationMs: audio.durationMs })
    .where(and(eq(audioAssets.id, audioId), eq(audioAssets.state, 'pending')))
    .returning({ id: audioAssets.id });
  return marked.length === 1;
}
