// Test doubles for speech synthesis. Only test files import this module; the architecture has CI
// replace the speech model with a double, since the model is 400 MB.
//
// - toneEngine(): a speech engine whose samples are a fixed tone, 10 ms per character of text, so
//   the length of every synthesis is known in advance.
// - fakeMp3() and mp3Encoder(): a valid MP3 for a number of samples, a run of silent 32 kbps mono
//   Layer III frames behind an ID3v2 tag with the comment, which readMp3 reads like lame's output.
// - failing stand-ins for the engine and the encoder.
import { PCM_BYTES_PER_SAMPLE } from './domain/pcm.ts';
import type { Mp3Encoder } from './server/mp3-encoder.ts';
import type { SpeechEngine } from './server/speech-engine.ts';

export const TEST_SAMPLE_RATE = 44_100;

/** Samples the tone engine gives each character of text. */
export const SAMPLES_PER_CHARACTER = 441;

export type ToneEngine = SpeechEngine & { texts: string[] };

export function toneEngine(): ToneEngine {
  const engine: ToneEngine = {
    sampleRate: TEST_SAMPLE_RATE,
    texts: [],
    async synthesize(text) {
      engine.texts.push(text);
      return Float32Array.from(
        { length: text.length * SAMPLES_PER_CHARACTER },
        (_, index) => 0.25 * Math.sin((2 * Math.PI * 440 * index) / TEST_SAMPLE_RATE),
      );
    },
  };
  return engine;
}

export function failingEngine(message = 'The test model failed.'): SpeechEngine {
  return {
    sampleRate: TEST_SAMPLE_RATE,
    async synthesize() {
      throw new Error(message);
    },
  };
}

function id3v2Comment(comment: string): Uint8Array {
  const text = new TextEncoder().encode(comment);
  // COMM: latin1 encoding, language `eng`, an empty description, then the text.
  const body = Uint8Array.from([0, 0x65, 0x6e, 0x67, 0, ...text]);
  const frame = new Uint8Array(10 + body.length);
  frame.set([0x43, 0x4f, 0x4d, 0x4d]);
  new DataView(frame.buffer).setUint32(4, body.length);
  frame.set(body, 10);
  const size = frame.length;
  const header = Uint8Array.from([
    0x49,
    0x44,
    0x33,
    3,
    0,
    0,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
  return Uint8Array.from([...header, ...frame]);
}

/** Bytes of a 32 kbps mono MPEG-1 Layer III frame at 44.1 kHz. */
const FRAME_BYTES = 104;

/** A valid MP3 lasting at least `samples` samples at 44.1 kHz, with the ID3v2 comment. */
export function fakeMp3(samples: number, comment: string): Uint8Array {
  const tag = id3v2Comment(comment);
  const frames = Math.max(1, Math.ceil(samples / 1152));
  const bytes = new Uint8Array(tag.length + frames * FRAME_BYTES);
  bytes.set(tag);
  for (let index = 0; index < frames; index += 1) {
    bytes.set([0xff, 0xfb, 0x10, 0xc0], tag.length + index * FRAME_BYTES);
  }
  return bytes;
}

export type EncodedInput = { pcm: Uint8Array; sampleRateHz: number };

export type EncoderDouble = Mp3Encoder & { inputs: EncodedInput[] };

/** An encoder that answers fakeMp3 for the PCM it gets, and records the PCM. */
export function mp3Encoder(comment = 'AI-generated voice (Supertonic 3)'): EncoderDouble {
  const inputs: EncodedInput[] = [];
  const encode: Mp3Encoder = async (pcm, sampleRateHz) => {
    inputs.push({ pcm, sampleRateHz });
    return fakeMp3(pcm.byteLength / PCM_BYTES_PER_SAMPLE, comment);
  };
  return Object.assign(encode, { inputs });
}

export const failingEncoder: Mp3Encoder = async () => {
  throw new Error('The test encoder failed.');
};
