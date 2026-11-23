// Word and example speech for playback (.docs/design/rules.md, 朗读和存储上限 and 用量记录):
//   1. the live audio row of the text's cache key, which is played at once when it is ready;
//   2. otherwise a `pending` row, inserted unless another request did first;
//   3. for a pending row, a call to vexto-tts writing the row's object key, between a `pending`
//      usage record and its outcome; then the row is marked ready with its size and duration.
// A failed call leaves the row pending for the next request. Two requests that meet the same
// pending row both call the service; they write the same object, and the second finds the row
// already ready. Nothing here runs inside a transaction.
import { ApiError } from '../../../lib/api/errors.ts';
import {
  speechConfig,
  speechVersionOf,
  type SpeechConfig,
} from '../../../lib/config/speech-config.ts';
import { getDatabase, type Database } from '../../../lib/db/client.ts';
import { errorFields, log } from '../../../lib/log.ts';
import { objectUrlsFromEnv, type ObjectUrls } from '../../../lib/storage/presigned-url.ts';
import {
  findLiveAudio,
  markAudioReady,
  normalizeSpeechText,
  SPEECH_TEXT_MAX_LENGTH,
  speechAudioRow,
  speechCacheKey,
  type LiveAudioRow,
  type SpeechAnswer,
} from '../../audio/index.ts';
import { trackUsage, type UsageOutcome } from '../../usage/index.ts';
import {
  PLAYBACK_URL_SECONDS,
  playbackExpiry,
  type PlayableAudio,
  type Playback,
  type SpeechUsageKind,
} from '../domain/playback.ts';
import {
  speechServiceFromEnv,
  SpeechServiceError,
  type SpeechServiceClient,
} from './speech-service-client.ts';

export type PlaybackServices = {
  database: Database;
  speechService: SpeechServiceClient;
  urls: ObjectUrls;
  config: SpeechConfig;
  now: () => Date;
};

type Remote = Pick<PlaybackServices, 'speechService' | 'urls'>;

let remote: Remote | undefined;

/**
 * The shared database, the speech service and bucket of the runtime values, and the clock. The
 * speech service client and the bucket's signer are made once per process, so the identity token
 * and the signing client are reused across requests.
 */
export function playbackServices(): PlaybackServices {
  remote ??= { speechService: speechServiceFromEnv(), urls: objectUrlsFromEnv() };
  return { ...remote, database: getDatabase(), config: speechConfig, now: () => new Date() };
}

export type SpeechToPlay = {
  /** The word's lemma or the example sentence, as stored. */
  text: string;
  usageKind: SpeechUsageKind;
  /** The member the speech is made for, recorded on the usage record. */
  ownerId: string;
};

function outcomeOfError(error: unknown): UsageOutcome {
  if (error instanceof SpeechServiceError) {
    return { status: error.outcome, errorCode: error.code };
  }
  return { status: 'failed', errorCode: 'internal' };
}

function playable(row: LiveAudioRow): PlayableAudio | null {
  return row.state === 'ready' && row.durationMs !== null
    ? { objectKey: row.objectKey, durationMs: row.durationMs }
    : null;
}

function synthesize(
  services: PlaybackServices,
  row: LiveAudioRow,
  text: string,
  speech: SpeechToPlay,
): Promise<SpeechAnswer> {
  const { config } = services;
  const usage = {
    kind: speech.usageKind,
    provider: config.provider,
    model: config.model,
    engineRevision: config.modelRevision,
    ownerId: speech.ownerId,
    resourceType: 'audio',
    resourceId: row.id,
  };
  return trackUsage(
    services.database,
    usage,
    async () => {
      const answer = await services.speechService.synthesize({
        key: row.objectKey,
        text,
        voice: config.voice,
        modelRevision: config.modelRevision,
        encodingVersion: config.encoding.version,
      });
      const outcome: UsageOutcome = {
        status: 'succeeded',
        audioMs: answer.durationMs,
        cpuMs: answer.usage.cpuMs,
        byteCount: answer.byteSize,
      };
      return { result: answer, outcome };
    },
    outcomeOfError,
  );
}

async function synthesizedAudio(
  services: PlaybackServices,
  row: LiveAudioRow,
  text: string,
  speech: SpeechToPlay,
): Promise<PlayableAudio> {
  let answer: SpeechAnswer;
  try {
    answer = await synthesize(services, row, text, speech);
  } catch (error) {
    log('WARNING', 'The speech service did not make the audio.', {
      audioId: row.id,
      ...errorFields(error),
    });
    throw new ApiError('UNAVAILABLE', 'The speech service is not available.');
  }
  if (await markAudioReady(services.database, row.id, answer)) {
    return { objectKey: row.objectKey, durationMs: answer.durationMs };
  }
  // Another request marked the row first, or it was retired meanwhile.
  const cacheKey = speechCacheKey(text, speechVersionOf(services.config));
  const current = await findLiveAudio(services.database, cacheKey);
  const ready = current && playable(current);
  if (!ready) {
    throw new ApiError('UNAVAILABLE', 'The audio was retired while it was made.');
  }
  return ready;
}

/** The ready audio of a word or example, made by the speech service when there is none. */
export async function readySpeechAudio(
  services: PlaybackServices,
  speech: SpeechToPlay,
): Promise<PlayableAudio> {
  const text = normalizeSpeechText(speech.text);
  if (text === '' || text.length > SPEECH_TEXT_MAX_LENGTH) {
    throw new Error(`Speech text must have 1 to ${SPEECH_TEXT_MAX_LENGTH} characters.`);
  }
  const row = await speechAudioRow(services.database, text, speechVersionOf(services.config));
  return playable(row) ?? synthesizedAudio(services, row, text, speech);
}

/** The playback answer for an audio object: its presigned address, expiry and length. */
export async function signedPlayback(
  services: PlaybackServices,
  audio: PlayableAudio,
): Promise<Playback> {
  const expiresAt = playbackExpiry(services.now());
  const url = await services.urls.getUrl(audio.objectKey, PLAYBACK_URL_SECONDS);
  return { url, expiresAt, durationMs: audio.durationMs };
}
