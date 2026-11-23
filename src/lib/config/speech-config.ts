// How speech is made (.docs/design/rules.md, 朗读和存储上限): the voice and reading settings of
// config/speech.json and the pinned model of config/speech-model.json. The collection job and the
// speech service synthesize with it; the web application reads it for the cache keys of word and
// example audio and for what it asks the speech service for, so every audio row records the voice,
// model revision and encoding version it was made with.
import { z } from 'zod';
import rawModel from '../../../config/speech-model.json' with { type: 'json' };
import rawSpeech from '../../../config/speech.json' with { type: 'json' };
import { parseConfig } from './config-error.ts';

const plainName = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a plain lower-case name');

/** Bitrates lame writes for MPEG-1 Layer III, in kbps. */
const MP3_BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;

/** Output sample rates lame can resample to, in Hz. */
const MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000] as const;

const speechShape = z.strictObject({
  /** Such as `supertonic`; recorded on usage records. */
  provider: plainName,
  /** The voice style; the model directory has voice_styles/<voice>.json. */
  voice: z.string().regex(/^[A-Za-z0-9_-]+$/, 'must be a voice style name such as F1'),
  /** The language tag the model reads the text in. */
  language: z.string().regex(/^[a-z]{2}$/, 'must be a two-letter language code'),
  totalSteps: z.number().int().min(1).max(50),
  speed: z.number().min(0.5).max(2),
  /** Silence between two sentences of an article. */
  sentenceGapMs: z.number().int().min(0).max(5000),
  encoding: z.strictObject({
    /** Recorded on every audio row; a change of the settings below gets a new version. */
    version: plainName,
    bitrateKbps: z.union(MP3_BITRATES.map((rate) => z.literal(rate))),
    sampleRateHz: z.union(MP3_SAMPLE_RATES.map((rate) => z.literal(rate))),
    /** The ID3 comment of every MP3, saying the voice is machine-generated. */
    comment: z.string().min(1).max(200),
  }),
});

// config/speech-model.json is validated in full by scripts/lib/speech-model.ts; the application
// needs only the model's name and pinned revision.
const modelShape = z.object({
  name: plainName,
  revision: z.string().regex(/^[0-9a-f]{40}$/, 'must be a full commit SHA'),
});

export type SpeechConfig = z.infer<typeof speechShape> & {
  /** The model's name, such as `supertonic-3`. */
  model: string;
  /** The pinned revision of the model. */
  modelRevision: string;
};

/** What an audio row records about how it was made. */
export type SpeechVersion = { voice: string; modelRevision: string; encoding: string };

export function parseSpeechConfig(speech: unknown, model: unknown): SpeechConfig {
  const settings = parseConfig('config/speech.json', speechShape, speech);
  const pinned = parseConfig('config/speech-model.json', modelShape, model);
  return { ...settings, model: pinned.name, modelRevision: pinned.revision };
}

export function speechVersionOf(config: SpeechConfig): SpeechVersion {
  return {
    voice: config.voice,
    modelRevision: config.modelRevision,
    encoding: config.encoding.version,
  };
}

/** The committed speech configuration, validated when this module loads. */
export const speechConfig: SpeechConfig = parseSpeechConfig(rawSpeech, rawModel);
