import { describe, expect, it } from 'vitest';
import { readMp3 } from '../domain/mp3-format.ts';
import {
  failingEncoder,
  failingEngine,
  mp3Encoder,
  SAMPLES_PER_CHARACTER,
  TEST_SAMPLE_RATE,
  toneEngine,
} from '../testing.ts';
import { narrate, NarrationError } from './narration.ts';

describe('narrate', () => {
  it('reads each text, puts the silence between them and encodes the whole once', async () => {
    const engine = toneEngine();
    const encoder = mp3Encoder();

    const narration = await narrate(engine, encoder, ['One two.', 'Three.'], 300);

    expect(engine.texts).toEqual(['One two.', 'Three.']);
    expect(encoder.inputs).toHaveLength(1);
    const gap = 0.3 * TEST_SAMPLE_RATE;
    const samples = (8 + 6) * SAMPLES_PER_CHARACTER + gap;
    expect(encoder.inputs[0]).toMatchObject({ sampleRateHz: TEST_SAMPLE_RATE });
    expect(encoder.inputs[0].pcm.byteLength).toBe(samples * 2);
    expect(narration.timings).toEqual([
      { startMs: 0, endMs: 80 },
      { startMs: 380, endMs: 440 },
    ]);
    expect(narration.durationMs).toBe(440);
    expect(readMp3(narration.mp3).comment).toBe('AI-generated voice (Supertonic 3)');
    expect(Number.isInteger(narration.cpuMs) && narration.cpuMs >= 0).toBe(true);
  });

  it('reports a failed synthesis as the synthesis step without the text', async () => {
    const error = await narrate(failingEngine(), mp3Encoder(), ['Private words.'], 0).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(NarrationError);
    expect(error).toMatchObject({ step: 'synthesis', message: 'Synthesizing text 1 failed.' });
  });

  it('reports a failed encoding as the encoding step', async () => {
    await expect(narrate(toneEngine(), failingEncoder, ['Hi.'], 0)).rejects.toMatchObject({
      step: 'encoding',
    });
  });

  it('refuses to encode when the synthesis gave no audio', async () => {
    await expect(narrate(toneEngine(), mp3Encoder(), [], 0)).rejects.toMatchObject({
      step: 'synthesis',
      message: 'The synthesis gave no audio.',
    });
  });
});
