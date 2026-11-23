// The article synthesizer with the speech model replaced by a test double, lame by an encoder
// that writes a valid MP3, and the S3Mock bucket: the uploaded audio, the timeline and the error
// codes of each failing step.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { speechConfig } from '../../../lib/config/speech-config.ts';
import {
  createObjectStorage,
  storageSettingsFromEnv,
} from '../../../lib/storage/object-storage.ts';
import { failingStorage, testBucket } from '../../../lib/storage/testing.ts';
import { readMp3 } from '../../speech/index.ts';
import {
  failingEncoder,
  failingEngine,
  mp3Encoder,
  SAMPLES_PER_CHARACTER,
  TEST_SAMPLE_RATE,
  toneEngine,
} from '../../speech/testing.ts';
import { ArticleSynthesisError } from './article-synthesizer.ts';
import { createSpeechSynthesizer, type SpeechSynthesizerParts } from './speech-synthesizer.ts';

function synthesizer(parts: Partial<SpeechSynthesizerParts> = {}) {
  return createSpeechSynthesizer({
    engine: toneEngine(),
    encoder: mp3Encoder(speechConfig.encoding.comment),
    storage: createObjectStorage(storageSettingsFromEnv()),
    config: speechConfig,
    ...parts,
  });
}

function request(sentences = ['A quiet wing flew.', 'It landed.']) {
  return { articleId: randomUUID(), objectKey: `articles/${randomUUID()}.mp3`, sentences };
}

const ms = (characters: number) =>
  Math.round((characters * SAMPLES_PER_CHARACTER * 1000) / TEST_SAMPLE_RATE);

describe('the speech article synthesizer', () => {
  it('records the configured voice', () => {
    expect(synthesizer().voice).toEqual({
      provider: speechConfig.provider,
      model: speechConfig.model,
      voice: speechConfig.voice,
      modelRevision: speechConfig.modelRevision,
      encoding: speechConfig.encoding.version,
    });
  });

  it('uploads one MP3 of every sentence and gives each sentence its place in it', async () => {
    const engine = toneEngine();
    const asked = request();

    const result = await synthesizer({ engine }).synthesize(asked);

    const gap = speechConfig.sentenceGapMs;
    expect(engine.texts).toEqual(asked.sentences);
    expect(result.sentenceTimings).toEqual([
      { startMs: 0, endMs: ms(18) },
      { startMs: ms(18) + gap, endMs: ms(18) + gap + ms(10) },
    ]);
    expect(result.durationMs).toBe(ms(18) + gap + ms(10));
    const stored = await testBucket().read(asked.objectKey);
    expect(result.byteSize).toBe(stored.bytes.byteLength);
    expect(stored.contentType).toBe('audio/mpeg');
    expect(readMp3(stored.bytes).comment).toBe(speechConfig.encoding.comment);
  });

  it.each([
    ['the model', { engine: failingEngine('Model failed on: A quiet wing flew.') }, 'tts_error'],
    ['the encoder', { encoder: failingEncoder }, 'encode_error'],
    ['the upload', { storage: failingStorage }, 'upload_error'],
  ] as const)('reports a failure of %s as %s without the text', async (_, parts, code) => {
    const error = await synthesizer(parts)
      .synthesize(request())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ArticleSynthesisError);
    expect((error as ArticleSynthesisError).code).toBe(code);
    expect((error as Error).message).not.toContain('quiet wing');
  });
});
