// The audio row of an article (.docs/design/rules.md, 合成和发布 and 朗读和存储上限). Its
// cache_key is the SHA-256 of `article`, the article ID, the voice, the model revision and the
// encoding, one per line, and its object key is `articles/<audio ID>.mp3`. Every attempt at an
// article's audio uses the one row that is waiting for it, and writes the same object.
import type { Executor } from '../../../lib/db/client.ts';
import { sha256Hex } from '../../../lib/digest.ts';
import { articleAudioObjectKey } from '../domain/audio-asset.ts';
import { liveAudioRow, type AudioVersion } from './audio-rows.ts';

export function articleAudioCacheKey(articleId: string, version: AudioVersion): string {
  return sha256Hex(
    ['article', articleId, version.voice, version.modelRevision, version.encoding].join('\n'),
  );
}

export type ArticleAudioRow = { id: string; objectKey: string };

/**
 * The article's audio row that is not retiring: a new `pending` row with a new ID and object key,
 * or the row an earlier attempt left.
 */
export async function articleAudioRow(
  executor: Executor,
  articleId: string,
  version: AudioVersion,
): Promise<ArticleAudioRow> {
  const row = await liveAudioRow(executor, {
    cacheKey: articleAudioCacheKey(articleId, version),
    objectKeyOf: articleAudioObjectKey,
    version,
  });
  return { id: row.id, objectKey: row.objectKey };
}
