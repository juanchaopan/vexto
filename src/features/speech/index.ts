export { Mp3FormatError, readMp3, type Mp3Summary } from './domain/mp3-format.ts';
export type { PieceTiming } from './domain/timeline.ts';
export { lameEncoder, type Mp3Encoder, type Mp3Output } from './server/mp3-encoder.ts';
export { narrate, NarrationError, type Narration, type NarrationStep } from './server/narration.ts';
export type { SpeechEngine } from './server/speech-engine.ts';
export { configuredEncoder, loadSpeechEngine } from './server/speech-runtime.ts';
export {
  createSynthesisService,
  synthesisServiceFromEnv,
  type SynthesisService,
  type SynthesisServiceDependencies,
} from './server/synthesis-service.ts';
