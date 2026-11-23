// The one audio row of a cache key that is not retiring (.docs/design/rules.md, 朗读和存储上限).
// Among such rows a cache key is unique, so every request for the same audio finds the same row:
// an existing one, or a new `pending` row with a new ID and object key. When two requests insert
// at once, the first insert wins (ON CONFLICT DO NOTHING) and both read the row back.
import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import type { SpeechVersion } from '../../../lib/config/speech-config.ts';
import { audioAssets } from './schema.ts';

/** What an audio was made with, as each audio row records it. */
export type AudioVersion = SpeechVersion;

export type LiveAudioRow = {
  id: string;
  objectKey: string;
  state: 'pending' | 'ready';
  byteSize: number | null;
  durationMs: number | null;
};

/**
 * The predicate of the partial unique index on cache_key, written as a literal: ON CONFLICT
 * finds the index only when its WHERE implies the index's own.
 */
const uniqueAmongLive = sql.raw(`state <> 'retiring'`);

const liveColumns = {
  id: audioAssets.id,
  objectKey: audioAssets.objectKey,
  state: audioAssets.state,
  byteSize: audioAssets.byteSize,
  durationMs: audioAssets.durationMs,
};

/** The row of this cache key that is not retiring, if there is one. */
export async function findLiveAudio(
  executor: Executor,
  cacheKey: string,
): Promise<LiveAudioRow | undefined> {
  const [row] = await executor
    .select(liveColumns)
    .from(audioAssets)
    .where(and(eq(audioAssets.cacheKey, cacheKey), ne(audioAssets.state, 'retiring')));
  return row as LiveAudioRow | undefined;
}

export type AudioRowRequest = {
  cacheKey: string;
  /** The object key of a new row, from its ID. */
  objectKeyOf: (audioId: string) => string;
  version: AudioVersion;
};

/** The live row of the cache key, inserting a `pending` one when there is none. */
export async function liveAudioRow(
  executor: Executor,
  request: AudioRowRequest,
): Promise<LiveAudioRow> {
  const existing = await findLiveAudio(executor, request.cacheKey);
  if (existing) {
    return existing;
  }
  const id = randomUUID();
  await executor
    .insert(audioAssets)
    .values({
      id,
      cacheKey: request.cacheKey,
      objectKey: request.objectKeyOf(id),
      state: 'pending',
      ...request.version,
    })
    .onConflictDoNothing({ target: audioAssets.cacheKey, where: uniqueAmongLive });
  const row = await findLiveAudio(executor, request.cacheKey);
  if (!row) {
    throw new Error('The audio row of the cache key was retired as it was made.');
  }
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
