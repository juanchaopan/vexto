// What the narration needs from a speech model: its sample rate and a way to turn one piece of
// text into mono samples between -1 and 1. The Supertonic model is the production engine; tests
// use a double that returns fixed samples (src/features/speech/testing.ts).

export type SpeechEngine = {
  /** Samples per second of what synthesize returns. */
  readonly sampleRate: number;
  synthesize(text: string): Promise<Float32Array>;
};
