// `POST /api/media/playback` (.docs/design/interfaces.md, 取得播放地址): the presigned address of
// what the locator plays, its expiry and its length. Article audio always exists; word and example
// audio is made by the speech service when there is none yet, before the answer.
import { dataResult, type ApiResult } from '../../../lib/api/responses.ts';
import {
  playbackServices,
  readySpeechAudio,
  signedPlayback,
  type PlaybackServices,
} from '../../playback/index.ts';
import type { PlaybackLocator } from '../domain/locator.ts';
import { playbackSource } from './playback-source.ts';

export async function playbackResult(
  ownerId: string,
  locator: PlaybackLocator,
  services: PlaybackServices = playbackServices(),
): Promise<ApiResult> {
  const source = await playbackSource(services.database, ownerId, locator);
  const audio =
    source.kind === 'audio'
      ? source.audio
      : await readySpeechAudio(services, {
          text: source.text,
          usageKind: source.usageKind,
          ownerId,
        });
  return dataResult(await signedPlayback(services, audio));
}
