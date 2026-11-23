// Narration: texts read one by one by the speech engine, laid one after another with silence
// between them, and encoded once into one MP3 (.docs/design/rules.md, 合成和发布). The model gives
// no timestamps, so each text's place in the audio follows from its samples. The CPU time is this
// process's own, all its threads included, from the first synthesis to the end of the encoding;
// lame runs as a child process, whose small share is not counted.
import { joinPcm16 } from '../domain/pcm.ts';
import { silenceSamples, timelineOf, type PieceTiming } from '../domain/timeline.ts';
import type { Mp3Encoder } from './mp3-encoder.ts';
import type { SpeechEngine } from './speech-engine.ts';

export type Narration = {
  mp3: Uint8Array;
  durationMs: number;
  /** Where each text lies in the audio, in order. */
  timings: PieceTiming[];
  cpuMs: number;
};

export type NarrationStep = 'synthesis' | 'encoding';

/** The step a narration failed in; the message never contains the text. */
export class NarrationError extends Error {
  readonly step: NarrationStep;

  constructor(step: NarrationStep, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NarrationError';
    this.step = step;
  }
}

function cpuMsSince(start: NodeJS.CpuUsage) {
  const used = process.cpuUsage(start);
  return Math.round((used.user + used.system) / 1000);
}

async function synthesizeAll(engine: SpeechEngine, texts: readonly string[]) {
  const pieces: Float32Array[] = [];
  for (const [index, text] of texts.entries()) {
    try {
      pieces.push(await engine.synthesize(text));
    } catch (error) {
      throw new NarrationError('synthesis', `Synthesizing text ${index + 1} failed.`, {
        cause: error,
      });
    }
  }
  return pieces;
}

async function encode(encoder: Mp3Encoder, pcm: Uint8Array, sampleRate: number) {
  let mp3: Uint8Array;
  try {
    mp3 = await encoder(pcm, sampleRate);
  } catch (error) {
    throw new NarrationError('encoding', 'Encoding the audio failed.', { cause: error });
  }
  if (mp3.byteLength === 0) {
    throw new NarrationError('encoding', 'The encoder wrote no audio.');
  }
  return mp3;
}

export async function narrate(
  engine: SpeechEngine,
  encoder: Mp3Encoder,
  texts: readonly string[],
  gapMs: number,
): Promise<Narration> {
  const cpuStart = process.cpuUsage();
  const pieces = await synthesizeAll(engine, texts);
  const gap = silenceSamples(gapMs, engine.sampleRate);
  const timeline = timelineOf(
    pieces.map((piece) => piece.length),
    engine.sampleRate,
    gap,
  );
  if (timeline.durationMs <= 0) {
    throw new NarrationError('synthesis', 'The synthesis gave no audio.');
  }
  const mp3 = await encode(encoder, joinPcm16(pieces, gap), engine.sampleRate);
  return {
    mp3,
    durationMs: timeline.durationMs,
    timings: timeline.timings,
    cpuMs: cpuMsSince(cpuStart),
  };
}
