// The audio rows of words and example sentences (.docs/design/rules.md, 朗读和存储上限). They are
// shared by everyone: the cache key is the SHA-256 of the normalized text, the voice, the model
// revision and the encoding, one per line, so the same text has one audio whether it is a word or
// an example. The object key is `speech/<audio ID>.mp3` and never contains the text.
import type { Executor } from '../../../lib/db/client.ts';
import { sha256Hex } from '../../../lib/digest.ts';
import { normalizeSpeechText, speechObjectKey } from '../domain/audio-asset.ts';
import { liveAudioRow, type AudioVersion, type LiveAudioRow } from './audio-rows.ts';

export function speechCacheKey(text: string, version: AudioVersion): string {
  return sha256Hex(
    [normalizeSpeechText(text), version.voice, version.modelRevision, version.encoding].join('\n'),
  );
}

/** The text's live audio row, a new `pending` one when it has none. */
export function speechAudioRow(
  executor: Executor,
  text: string,
  version: AudioVersion,
): Promise<LiveAudioRow> {
  return liveAudioRow(executor, {
    cacheKey: speechCacheKey(text, version),
    objectKeyOf: speechObjectKey,
    version,
  });
}
