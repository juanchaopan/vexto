// The vexto-tts entry with the speech model replaced by a test double, lame by an encoder that
// writes a valid MP3, and the S3Mock bucket: what a synthesis writes and answers, how the model
// loads, and the answers to requests it cannot serve.
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { speechConfig } from '../lib/config/speech-config.ts';
import { listen } from '../lib/http-server.ts';
import { createObjectStorage, storageSettingsFromEnv } from '../lib/storage/object-storage.ts';
import { failingStorage, testBucket } from '../lib/storage/testing.ts';
import { createSynthesisService, readMp3, type SpeechEngine } from '../features/speech/index.ts';
import {
  failingEngine,
  mp3Encoder,
  SAMPLES_PER_CHARACTER,
  TEST_SAMPLE_RATE,
  toneEngine,
} from '../features/speech/testing.ts';
import { createTtsServer } from './tts.ts';

type Service = Parameters<typeof createSynthesisService>[0];

let server: Server | undefined;
let baseUrl: string;
let logged: Record<string, unknown>[];

async function start(overrides: Partial<Service> = {}) {
  const engine = toneEngine();
  const loads = { count: 0 };
  const service = createSynthesisService({
    loadEngine: async () => {
      loads.count += 1;
      return engine;
    },
    encoder: mp3Encoder(speechConfig.encoding.comment),
    storage: createObjectStorage(storageSettingsFromEnv()),
    config: speechConfig,
    ...overrides,
  });
  server = createTtsServer(service);
  baseUrl = `http://127.0.0.1:${await listen(server, 0)}`;
  return { engine, loads, service };
}

function speechKey() {
  return `speech/${randomUUID()}.mp3`;
}

function requestBody(fields: Record<string, unknown> = {}) {
  return {
    key: speechKey(),
    text: 'take off',
    voice: speechConfig.voice,
    modelRevision: speechConfig.modelRevision,
    encodingVersion: speechConfig.encoding.version,
    ...fields,
  };
}

function post(body: unknown) {
  return fetch(`${baseUrl}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeAll(() => {
  // Keep the service's log lines out of the test output, and readable by the tests.
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    logged.push(JSON.parse(String(chunk)) as Record<string, unknown>);
    return true;
  });
});

beforeEach(() => {
  logged = [];
});

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = undefined;
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('vexto-tts', () => {
  it('answers the health check', async () => {
    await start();
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('synthesizes the text, writes the MP3 to the key and answers its size and duration', async () => {
    const { engine } = await start();
    const body = requestBody();

    const response = await post(body);

    expect(response.status).toBe(200);
    const answer = (await response.json()) as Record<string, unknown>;
    const stored = await testBucket().read(body.key);
    expect(answer).toEqual({
      key: body.key,
      byteSize: stored.bytes.byteLength,
      durationMs: Math.round((8 * SAMPLES_PER_CHARACTER * 1000) / TEST_SAMPLE_RATE),
      usage: { cpuMs: expect.any(Number) },
    });
    expect(stored.contentType).toBe('audio/mpeg');
    expect(readMp3(stored.bytes).comment).toBe(speechConfig.encoding.comment);
    expect(engine.texts).toEqual(['take off']);
    expect(JSON.stringify(logged)).not.toContain('take off');
  });

  it('overwrites the smoke test object each time', async () => {
    await start();

    expect((await post(requestBody({ key: 'smoke/check.mp3', text: 'one' }))).status).toBe(200);
    const first = (await testBucket().read('smoke/check.mp3')).bytes.byteLength;
    expect(
      (await post(requestBody({ key: 'smoke/check.mp3', text: 'a longer word' }))).status,
    ).toBe(200);

    expect((await testBucket().read('smoke/check.mp3')).bytes.byteLength).toBeGreaterThan(first);
  });

  it('loads the model once for every request of the instance', async () => {
    const { loads, service } = await start();

    await service.warmUp();
    await Promise.all([post(requestBody()), post(requestBody()), post(requestBody())]);

    expect(loads.count).toBe(1);
  });

  it('answers 503 and loads the model again on the next request when loading failed', async () => {
    let attempts = 0;
    const engine = toneEngine();
    await start({
      loadEngine: async (): Promise<SpeechEngine> => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('The model bucket is not mounted.');
        }
        return engine;
      },
    });

    const failed = await post(requestBody());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: {
        code: 'UNAVAILABLE',
        message: 'The speech could not be made or stored.',
        retryable: true,
      },
    });
    expect((await post(requestBody())).status).toBe(200);
    expect(attempts).toBe(2);
  });

  it('answers 503 when the model fails or the bucket cannot be written', async () => {
    await start({ loadEngine: async () => failingEngine() });
    expect((await post(requestBody())).status).toBe(503);
    await new Promise((resolve) => server!.close(resolve));

    await start({ storage: failingStorage });
    expect((await post(requestBody())).status).toBe(503);
    expect(logged.at(-1)).toMatchObject({ severity: 'ERROR', message: 'Speech synthesis failed.' });
  });

  it('refuses a voice, model revision or encoding it does not make with 422', async () => {
    const { engine } = await start();

    for (const fields of [
      { voice: 'M1' },
      { modelRevision: 'b'.repeat(40) },
      { encodingVersion: 'mp3-mono-48k-v1' },
    ]) {
      const response = await post(requestBody(fields));
      expect(response.status).toBe(422);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'INVALID_INPUT',
      );
    }
    expect(engine.texts).toEqual([]);
  });

  it('answers unknown paths with 404 and other methods with 405', async () => {
    await start();

    expect((await fetch(`${baseUrl}/speak`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/synthesize`)).status).toBe(405);
  });
});
