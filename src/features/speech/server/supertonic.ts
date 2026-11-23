// Supertonic 3 inference on onnxruntime-node.
//
// Adapted from nodejs/helper.js of the official Supertonic repository,
// https://github.com/supertone-oss-archive/supertonic, at its last commit
// 1e9799e964ea4c0dad7cde993b65c3c813a7b373 (the repository is archived), which runs the model
// files of supertone-oss-archive/supertonic-3 at revision aafc6e32416a594460b32413efc49d7fe4ce6d46.
// What was adapted for this project:
// - written in TypeScript with typed arrays (Float32Array, BigInt64Array) for the tensors instead
//   of nested JavaScript arrays, for a single speaker only (batch size 1);
// - one voice style and the model directory are given by the caller; nothing is printed, and the
//   GPU, batch, WAV-writing, timer and file-name helpers are left out;
// - text is indexed by UTF-16 code unit throughout, and characters the model has no index for
//   are left out instead of being passed to the model as -1;
// - the samples of a synthesis are cut to the duration the model predicts, as the example
//   program of the repository does before writing its WAV file;
// - the sessions use as many threads as the CPUs the process may use, which on Cloud Run is the
//   instance's vCPUs rather than the host's cores onnxruntime would otherwise count.
//
// The original copyright and license:
//
// MIT License
//
// Copyright (c) 2025 Supertone Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import type { SpeechEngine } from './speech-engine.ts';

const AVAILABLE_LANGS = [
  'en',
  'ko',
  'ja',
  'ar',
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'es',
  'et',
  'fi',
  'fr',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'lt',
  'lv',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'tr',
  'uk',
  'vi',
  'na',
];

/** How the model reads: the language tag, the denoising steps and the speaking speed. */
export type SupertonicSettings = { language: string; totalSteps: number; speed: number };

const EMOJI_PATTERN =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

const SYMBOL_REPLACEMENTS: readonly [string, string][] = [
  ['–', '-'],
  ['‑', '-'],
  ['—', '-'],
  ['_', ' '],
  ['“', '"'],
  ['”', '"'],
  ['‘', "'"],
  ['’', "'"],
  ['´', "'"],
  ['`', "'"],
  ['[', ' '],
  [']', ' '],
  ['|', ' '],
  ['/', ' '],
  ['#', ' '],
  ['→', ' '],
  ['←', ' '],
];

const EXPRESSION_REPLACEMENTS: readonly [string, string][] = [
  ['@', ' at '],
  ['e.g.,', 'for example, '],
  ['i.e.,', 'that is, '],
];

const PUNCTUATION_SPACING: readonly [RegExp, string][] = [
  [/ ,/g, ','],
  [/ \./g, '.'],
  [/ !/g, '!'],
  [/ \?/g, '?'],
  [/ ;/g, ';'],
  [/ :/g, ':'],
  [/ '/g, "'"],
];

function collapseRepeats(text: string, pair: string): string {
  let result = text;
  while (result.includes(pair)) {
    result = result.replace(pair, pair[0]);
  }
  return result;
}

/** The text the model reads: normalized, cleaned of symbols it does not voice, language-tagged. */
export function preprocessText(input: string, lang: string): string {
  if (!AVAILABLE_LANGS.includes(lang)) {
    throw new Error(`Invalid language: ${lang}. Available: ${AVAILABLE_LANGS.join(', ')}`);
  }
  let text = input.normalize('NFKD').replace(EMOJI_PATTERN, '');
  for (const [from, to] of SYMBOL_REPLACEMENTS) {
    text = text.replaceAll(from, to);
  }
  text = text.replace(/[♥☆♡©\\]/g, '');
  for (const [from, to] of EXPRESSION_REPLACEMENTS) {
    text = text.replaceAll(from, to);
  }
  for (const [pattern, to] of PUNCTUATION_SPACING) {
    text = text.replace(pattern, to);
  }
  text = collapseRepeats(collapseRepeats(collapseRepeats(text, '""'), "''"), '``');
  text = text.replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) {
    text += '.';
  }
  return `<${lang}>${text}</${lang}>`;
}

const SENTENCE_BOUNDARY =
  /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/;

/** Packs a paragraph's sentences into chunks of at most maxLen characters where they fit. */
function packSentences(sentences: readonly string[], maxLen: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 <= maxLen) {
      current += (current ? ' ' : '') + sentence;
      continue;
    }
    if (current) {
      chunks.push(current.trim());
    }
    current = sentence;
  }
  if (current) {
    chunks.push(current.trim());
  }
  return chunks;
}

/** Splits text into chunks of at most maxLen characters at paragraph and sentence boundaries. */
export function chunkText(text: string, maxLen = 300): string[] {
  return text
    .trim()
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .flatMap((paragraph) => packSentences(paragraph.split(SENTENCE_BOUNDARY), maxLen));
}

/** Model ids of the text's UTF-16 code units; units without an id are left out. */
export function textIds(indexer: readonly number[], text: string): bigint[] {
  const ids: bigint[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const id = indexer[text.charCodeAt(index)];
    if (id !== undefined && id >= 0) {
      ids.push(BigInt(id));
    }
  }
  return ids;
}

type ModelConfig = {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
};

type Tensor3 = { dims: [number, number, number]; data: unknown };
type VoiceStyleFile = { style_ttl: Tensor3; style_dp: Tensor3 };

type Sessions = {
  durationPredictor: ort.InferenceSession;
  textEncoder: ort.InferenceSession;
  vectorEstimator: ort.InferenceSession;
  vocoder: ort.InferenceSession;
};

type Style = { ttl: ort.Tensor; dp: ort.Tensor };

/** Everything a loaded model consists of. */
type ModelParts = {
  config: ModelConfig;
  indexer: readonly number[];
  sessions: Sessions;
  style: Style;
  settings: SupertonicSettings;
};

function styleTensor(tensor: Tensor3): ort.Tensor {
  const data = Float32Array.from((tensor.data as unknown[]).flat(Infinity) as number[]);
  return new ort.Tensor('float32', data, tensor.dims);
}

/** Standard normal noise by the Box-Muller transform. */
function gaussianNoise(size: number): Float32Array {
  const noise = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const u1 = Math.max(1e-10, Math.random());
    const u2 = Math.random();
    noise[index] = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }
  return noise;
}

class TextToSpeech {
  readonly sampleRate: number;
  private readonly parts: ModelParts;
  private readonly chunkSize: number;
  private readonly latentDim: number;

  constructor(parts: ModelParts) {
    const { ae, ttl } = parts.config;
    this.parts = parts;
    this.sampleRate = ae.sample_rate;
    this.chunkSize = ae.base_chunk_size * ttl.chunk_compress_factor;
    this.latentDim = ttl.latent_dim * ttl.chunk_compress_factor;
  }

  /** Korean and Japanese chunks are kept shorter, as the original does. */
  private maxChunkLength() {
    const { language } = this.parts.settings;
    return language === 'ko' || language === 'ja' ? 120 : 300;
  }

  /** The noisy latent of a synthesis lasting `duration` seconds, with its mask. */
  private noisyLatent(duration: number) {
    const wavLength = Math.floor(duration * this.sampleRate);
    const latentLength = Math.floor(
      (duration * this.sampleRate + this.chunkSize - 1) / this.chunkSize,
    );
    const maskedLength = Math.floor((wavLength + this.chunkSize - 1) / this.chunkSize);
    const mask = new Float32Array(latentLength).map((_, t) => (t < maskedLength ? 1 : 0));
    const latent = gaussianNoise(this.latentDim * latentLength);
    for (let index = 0; index < latent.length; index += 1) {
      latent[index] *= mask[index % latentLength];
    }
    return { latent, mask, latentLength };
  }

  private async encode(chunk: string) {
    const { indexer, sessions, style, settings } = this.parts;
    const ids = textIds(indexer, preprocessText(chunk, settings.language));
    const textIdsTensor = new ort.Tensor('int64', BigInt64Array.from(ids), [1, ids.length]);
    const textMask = new ort.Tensor('float32', new Float32Array(ids.length).fill(1), [
      1,
      1,
      ids.length,
    ]);
    const { duration } = await sessions.durationPredictor.run({
      text_ids: textIdsTensor,
      style_dp: style.dp,
      text_mask: textMask,
    });
    const { text_emb: textEmb } = await sessions.textEncoder.run({
      text_ids: textIdsTensor,
      style_ttl: style.ttl,
      text_mask: textMask,
    });
    return { seconds: (duration.data as Float32Array)[0] / settings.speed, textEmb, textMask };
  }

  /** Synthesizes one chunk of text and returns its samples, cut to the predicted duration. */
  private async infer(chunk: string): Promise<Float32Array> {
    const { sessions, style, settings } = this.parts;
    const { seconds, textEmb, textMask } = await this.encode(chunk);
    const { latent, mask, latentLength } = this.noisyLatent(seconds);
    const latentDims = [1, this.latentDim, latentLength];
    const latentMask = new ort.Tensor('float32', mask, [1, 1, latentLength]);
    const totalStep = new ort.Tensor('float32', Float32Array.of(settings.totalSteps), [1]);
    for (let step = 0; step < settings.totalSteps; step += 1) {
      const { denoised_latent: denoised } = await sessions.vectorEstimator.run({
        noisy_latent: new ort.Tensor('float32', latent, latentDims),
        text_emb: textEmb,
        style_ttl: style.ttl,
        text_mask: textMask,
        latent_mask: latentMask,
        total_step: totalStep,
        current_step: new ort.Tensor('float32', Float32Array.of(step), [1]),
      });
      latent.set(denoised.data as Float32Array);
    }
    const { wav_tts: wav } = await sessions.vocoder.run({
      latent: new ort.Tensor('float32', latent, latentDims),
    });
    const samples = wav.data as Float32Array;
    return samples.slice(0, Math.min(samples.length, Math.floor(this.sampleRate * seconds)));
  }

  /** Synthesizes text of any length chunk by chunk, with 0.3 s of silence between chunks. */
  async call(text: string): Promise<Float32Array> {
    const silence = Math.floor(0.3 * this.sampleRate);
    const pieces: Float32Array[] = [];
    for (const chunk of chunkText(text, this.maxChunkLength())) {
      if (pieces.length > 0) {
        pieces.push(new Float32Array(silence));
      }
      pieces.push(await this.infer(chunk));
    }
    const joined = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
    let offset = 0;
    for (const piece of pieces) {
      joined.set(piece, offset);
      offset += piece.length;
    }
    return joined;
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/**
 * Loads the model files of `modelDir` (`onnx/` and `voice_styles/`) with the given voice style
 * and returns a speech engine reading in that voice.
 */
export async function loadSupertonic(
  modelDir: string,
  voice: string,
  settings: SupertonicSettings,
): Promise<SpeechEngine> {
  const onnxDir = path.join(modelDir, 'onnx');
  const options: ort.InferenceSession.SessionOptions = {
    intraOpNumThreads: availableParallelism(),
    interOpNumThreads: 1,
  };
  const session = (name: string) => ort.InferenceSession.create(path.join(onnxDir, name), options);
  const [config, indexer, voiceStyle, durationPredictor, textEncoder, vectorEstimator, vocoder] =
    await Promise.all([
      readJson<ModelConfig>(path.join(onnxDir, 'tts.json')),
      readJson<number[]>(path.join(onnxDir, 'unicode_indexer.json')),
      readJson<VoiceStyleFile>(path.join(modelDir, 'voice_styles', `${voice}.json`)),
      session('duration_predictor.onnx'),
      session('text_encoder.onnx'),
      session('vector_estimator.onnx'),
      session('vocoder.onnx'),
    ]);
  const tts = new TextToSpeech({
    config,
    indexer,
    sessions: { durationPredictor, textEncoder, vectorEstimator, vocoder },
    style: { ttl: styleTensor(voiceStyle.style_ttl), dp: styleTensor(voiceStyle.style_dp) },
    settings,
  });
  return { sampleRate: tts.sampleRate, synthesize: (text) => tts.call(text) };
}
