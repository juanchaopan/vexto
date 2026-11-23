// `POST /synthesize` of the speech service vexto-tts (.docs/design/interfaces.md, 朗读服务
// vexto-tts): reads one word or example in the configured voice, encodes it like every audio,
// writes the MP3 to the requested key of the bucket, replacing what is there, and answers the
// key, size, duration and CPU time. It decides nothing else and writes no database row: whether
// to synthesize, the audio row and the usage record are the web application's.
//
// The model loads once per instance, on the first request or when the entry warms it up, and a
// failed load is tried again by the next request. Syntheses run one at a time: the model already
// uses every CPU, and the CPU time measured for a request is then its own. Logs carry the key,
// which names only an audio ID, and never the text.
import { z } from 'zod';
import { speechConfig, type SpeechConfig } from '../../../lib/config/speech-config.ts';
import { errorResponse, type JsonRequest, type JsonResponse } from '../../../lib/http-server.ts';
import { errorFields, log } from '../../../lib/log.ts';
import { objectStorageFromEnv, type ObjectStorage } from '../../../lib/storage/object-storage.ts';
import {
  AUDIO_CONTENT_TYPE,
  speechRequestSchema,
  type SpeechAnswer,
  type SpeechRequest,
} from '../../audio/index.ts';
import type { Mp3Encoder } from './mp3-encoder.ts';
import { narrate } from './narration.ts';
import type { SpeechEngine } from './speech-engine.ts';
import { configuredEncoder, loadSpeechEngine } from './speech-runtime.ts';

export type SynthesisServiceDependencies = {
  loadEngine: () => Promise<SpeechEngine>;
  encoder: Mp3Encoder;
  storage: ObjectStorage;
  config: SpeechConfig;
};

export type SynthesisService = {
  /** Loads the model ahead of the first request; a failure is logged and tried again later. */
  warmUp(): Promise<void>;
  synthesize(request: JsonRequest): Promise<JsonResponse>;
};

function invalid(message: string): JsonResponse {
  return errorResponse(422, 'INVALID_INPUT', message, false);
}

function describeIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`);
}

/** Why the request asks for audio this service does not make, or null when it matches. */
function versionMismatch(request: SpeechRequest, config: SpeechConfig): string | null {
  const wanted = [
    ['voice', request.voice, config.voice],
    ['modelRevision', request.modelRevision, config.modelRevision],
    ['encodingVersion', request.encodingVersion, config.encoding.version],
  ] as const;
  const differing = wanted.filter(([, asked, served]) => asked !== served).map(([name]) => name);
  return differing.length === 0
    ? null
    : `The service does not make audio with this ${differing.join(', ')}.`;
}

/** Runs one piece of work at a time, in the order the work arrives. */
function oneAtATime() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = last.then(work, work);
    last = next.catch(() => undefined);
    return next;
  };
}

export function createSynthesisService(
  dependencies: SynthesisServiceDependencies,
): SynthesisService {
  const { config, storage, encoder } = dependencies;
  let loading: Promise<SpeechEngine> | undefined;
  const engine = () =>
    (loading ??= dependencies.loadEngine().catch((error: unknown) => {
      loading = undefined;
      throw error;
    }));
  const serially = oneAtATime();

  async function synthesizeAndStore(request: SpeechRequest): Promise<SpeechAnswer> {
    const narration = await narrate(await engine(), encoder, [request.text], 0);
    await storage.putObject(request.key, narration.mp3, AUDIO_CONTENT_TYPE);
    return {
      key: request.key,
      byteSize: narration.mp3.byteLength,
      durationMs: narration.durationMs,
      usage: { cpuMs: narration.cpuMs },
    };
  }

  return {
    async warmUp() {
      try {
        await engine();
        log('INFO', 'The speech model is loaded.');
      } catch (error) {
        log('ERROR', 'Loading the speech model failed.', errorFields(error));
      }
    },
    async synthesize({ body }) {
      const parsed = speechRequestSchema.safeParse(body);
      if (!parsed.success) {
        return invalid(`The request is invalid: ${describeIssues(parsed.error).join('; ')}.`);
      }
      const mismatch = versionMismatch(parsed.data, config);
      if (mismatch) {
        return invalid(mismatch);
      }
      try {
        const answer = await serially(() => synthesizeAndStore(parsed.data));
        log('INFO', 'Speech synthesized.', {
          key: answer.key,
          byteSize: answer.byteSize,
          durationMs: answer.durationMs,
          cpuMs: answer.usage.cpuMs,
        });
        return { status: 200, body: answer };
      } catch (error) {
        log('ERROR', 'Speech synthesis failed.', { key: parsed.data.key, ...errorFields(error) });
        return errorResponse(503, 'UNAVAILABLE', 'The speech could not be made or stored.', true);
      }
    },
  };
}

/** The service with the speech model at MODEL_DIR, lame and the bucket of the runtime values. */
export function synthesisServiceFromEnv(): SynthesisService {
  return createSynthesisService({
    loadEngine: () => loadSpeechEngine(speechConfig),
    encoder: configuredEncoder(speechConfig),
    storage: objectStorageFromEnv(),
    config: speechConfig,
  });
}
