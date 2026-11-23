import { expect, test } from '@playwright/test';
import { SMOKE_OBJECT_KEY } from '../src/features/audio/domain/audio-asset.ts';
import { readMp3 } from '../src/features/speech/domain/mp3-format.ts';
import { speechConfig } from '../src/lib/config/speech-config.ts';
import { testBucket } from '../src/lib/storage/testing.ts';

// The deployment job runs these against the deployed vexto-tts service, which accepts only
// callers with Run Invoker: it sets TTS_SERVICE_URL and TTS_ID_TOKEN, a Google identity token of
// its service account for that address, and the S3_* values of the target's bucket. Elsewhere,
// such as the end-to-end run against a local build, there is no service to call and the tests are
// skipped. Requests go through fetch rather than Playwright's request context, so the token never
// lands in a trace.
//
// The synthesis writes only the fixed smoke object smoke/check.mp3, replacing the one the last
// deployment wrote. The object has no audio row: nobody can play it, it is not counted against
// the storage cap, and no member's data changes, so the test is safe against production too.
const serviceUrl = process.env.TTS_SERVICE_URL;
const idToken = process.env.TTS_ID_TOKEN;

function callService(path: string, init: RequestInit = {}) {
  return fetch(new URL(path, serviceUrl), {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${idToken}` },
  });
}

test.describe('speech service', { tag: ['@smoke', '@production-safe'] }, () => {
  test.skip(!serviceUrl || !idToken, 'TTS_SERVICE_URL and TTS_ID_TOKEN are not set.');

  test('answers its health check for the deployment identity', async () => {
    const response = await callService('/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('synthesizes a word into a playable MP3 with the AI voice comment', async () => {
    // A service woken from zero loads the speech model before it answers.
    test.setTimeout(120_000);

    const response = await callService('/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: SMOKE_OBJECT_KEY,
        text: 'Hello',
        voice: speechConfig.voice,
        modelRevision: speechConfig.modelRevision,
        encodingVersion: speechConfig.encoding.version,
      }),
    });

    expect(response.status).toBe(200);
    const answer = (await response.json()) as { byteSize: number; durationMs: number };
    expect(answer).toMatchObject({
      key: SMOKE_OBJECT_KEY,
      byteSize: expect.any(Number),
      durationMs: expect.any(Number),
      usage: { cpuMs: expect.any(Number) },
    });
    const stored = await testBucket().read(SMOKE_OBJECT_KEY);
    expect(stored.contentType).toBe('audio/mpeg');
    expect(stored.bytes.byteLength).toBe(answer.byteSize);
    const mp3 = readMp3(stored.bytes);
    expect(mp3).toMatchObject({
      comment: speechConfig.encoding.comment,
      bitratesKbps: [speechConfig.encoding.bitrateKbps],
      sampleRateHz: speechConfig.encoding.sampleRateHz,
      channelMode: 'mono',
    });
    expect(mp3.durationMs).toBeGreaterThanOrEqual(answer.durationMs);
    expect(answer.durationMs).toBeGreaterThan(200);
  });
});
