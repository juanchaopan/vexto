// The production speech engine and encoder, from the speech configuration. The model is read
// from MODEL_DIR: on Cloud Run the mounted model bucket's directory of the pinned revision, on a
// development machine the directory `task model-download` fills. onnxruntime-node and the model
// code load only when the engine does, so a process that never synthesizes never loads them.
import { speechConfig, type SpeechConfig } from '../../../lib/config/speech-config.ts';
import { lameEncoder, type Mp3Encoder } from './mp3-encoder.ts';
import type { SpeechEngine } from './speech-engine.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** Loads the speech model at MODEL_DIR, reading in the configured voice. */
export async function loadSpeechEngine(
  config: SpeechConfig = speechConfig,
  env: Env = process.env,
): Promise<SpeechEngine> {
  const modelDir = env.MODEL_DIR;
  if (!modelDir) {
    throw new Error('MODEL_DIR is not set; it must name the speech model directory.');
  }
  const { loadSupertonic } = await import('./supertonic.ts');
  return loadSupertonic(modelDir, config.voice, {
    language: config.language,
    totalSteps: config.totalSteps,
    speed: config.speed,
  });
}

/** lame with the configured bitrate, sample rate and comment. */
export function configuredEncoder(config: SpeechConfig = speechConfig): Mp3Encoder {
  return lameEncoder({
    bitrateKbps: config.encoding.bitrateKbps,
    outputSampleRateHz: config.encoding.sampleRateHz,
    comment: config.encoding.comment,
  });
}
