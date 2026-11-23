// The real lame program, which the Cloud Run image installs. Development machines and CI runners
// may not have it; the tests are then skipped with the reason, and the image build runs the same
// check inside the image (worker.Dockerfile).
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { speechConfig } from '../../../lib/config/speech-config.ts';
import { readMp3 } from '../domain/mp3-format.ts';
import { joinPcm16 } from '../domain/pcm.ts';
import { lameEncoder } from './mp3-encoder.ts';
import { configuredEncoder } from './speech-runtime.ts';

const lameInstalled = spawnSync('lame', ['--version'], { stdio: 'ignore' }).status === 0;

function tone(seconds: number, sampleRate: number) {
  return Float32Array.from(
    { length: Math.round(seconds * sampleRate) },
    (_, index) => 0.3 * Math.sin((2 * Math.PI * 330 * index) / sampleRate),
  );
}

describe.skipIf(!lameInstalled)('lame (skipped: the lame program is not installed here)', () => {
  it('encodes PCM into a 32 kbps mono MP3 at 44.1 kHz with the AI voice comment', async () => {
    const pcm = joinPcm16([tone(1.5, 44_100), tone(0.5, 44_100)], 13_230);

    const mp3 = await configuredEncoder(speechConfig)(pcm, 44_100);

    const summary = readMp3(mp3);
    expect(summary).toMatchObject({
      comment: speechConfig.encoding.comment,
      bitratesKbps: [32],
      sampleRateHz: 44_100,
      channelMode: 'mono',
    });
    // lame adds its encoder delay and pads the last frame, a few frames at most.
    expect(summary.durationMs).toBeGreaterThanOrEqual(2300);
    expect(summary.durationMs).toBeLessThan(2300 + 200);
    expect(mp3.byteLength).toBeLessThan(((2.3 + 0.3) * 32_000) / 8 + 1024);
  });

  it('resamples PCM of another rate to the output rate', async () => {
    const mp3 = await configuredEncoder(speechConfig)(joinPcm16([tone(1, 24_000)], 0), 24_000);

    expect(readMp3(mp3)).toMatchObject({ sampleRateHz: 44_100, channelMode: 'mono' });
  });
});

describe('lameEncoder', () => {
  it('fails with the reason when the program cannot start', async () => {
    const encoder = lameEncoder(
      { bitrateKbps: 32, outputSampleRateHz: 44_100, comment: 'x' },
      'vexto-no-such-lame',
    );

    await expect(encoder(new Uint8Array(4), 44_100)).rejects.toThrow('lame could not start');
  });
});
