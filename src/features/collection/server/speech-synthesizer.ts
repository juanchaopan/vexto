// The article synthesizer of the collection job (.docs/design/rules.md, 合成和发布): the article's
// sentences narrated one by one in the configured voice with a silence between them, the
// timeline taken from each sentence's samples, the audio encoded once by lame and uploaded to the
// audio row's object key. A failed model, encoder or upload is an ArticleSynthesisError with its
// code, so the article is retried; messages never contain the article's text.
import { speechConfig, type SpeechConfig } from '../../../lib/config/speech-config.ts';
import { objectStorageFromEnv, type ObjectStorage } from '../../../lib/storage/object-storage.ts';
import { AUDIO_CONTENT_TYPE } from '../../audio/index.ts';
import {
  configuredEncoder,
  loadSpeechEngine,
  narrate,
  NarrationError,
  type Mp3Encoder,
  type Narration,
  type SpeechEngine,
} from '../../speech/index.ts';
import {
  ArticleSynthesisError,
  type ArticleSynthesizer,
  type ArticleSynthesizerLoader,
} from './article-synthesizer.ts';

export type SpeechSynthesizerParts = {
  engine: SpeechEngine;
  encoder: Mp3Encoder;
  storage: ObjectStorage;
  config: SpeechConfig;
};

async function narrated(parts: SpeechSynthesizerParts, sentences: readonly string[]) {
  try {
    return await narrate(parts.engine, parts.encoder, sentences, parts.config.sentenceGapMs);
  } catch (error) {
    if (error instanceof NarrationError) {
      const code = error.step === 'encoding' ? 'encode_error' : 'tts_error';
      throw new ArticleSynthesisError(code, error.message, { cause: error });
    }
    throw error;
  }
}

async function upload(storage: ObjectStorage, objectKey: string, narration: Narration) {
  try {
    await storage.putObject(objectKey, narration.mp3, AUDIO_CONTENT_TYPE);
  } catch (error) {
    throw new ArticleSynthesisError('upload_error', 'Uploading the article audio failed.', {
      cause: error,
    });
  }
}

export function createSpeechSynthesizer(parts: SpeechSynthesizerParts): ArticleSynthesizer {
  const { config } = parts;
  return {
    voice: {
      provider: config.provider,
      model: config.model,
      voice: config.voice,
      modelRevision: config.modelRevision,
      encoding: config.encoding.version,
    },
    async synthesize({ objectKey, sentences }) {
      const narration = await narrated(parts, sentences);
      await upload(parts.storage, objectKey, narration);
      return {
        byteSize: narration.mp3.byteLength,
        durationMs: narration.durationMs,
        sentenceTimings: narration.timings,
        cpuMs: narration.cpuMs,
      };
    },
  };
}

/** Loads the speech model at MODEL_DIR and makes the synthesizer that uploads to `storage`. */
export function speechSynthesizerLoader(
  storage: ObjectStorage = objectStorageFromEnv(),
  config: SpeechConfig = speechConfig,
): ArticleSynthesizerLoader {
  return async () =>
    createSpeechSynthesizer({
      engine: await loadSpeechEngine(config),
      encoder: configuredEncoder(config),
      storage,
      config,
    });
}
