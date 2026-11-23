// Hostile requests to vexto-tts: keys outside the two it may write, text that is too long or not
// normalized, and bodies that are not the request. Each is refused with 422 before the model
// reads anything, nothing is written to the bucket, and the answer does not repeat the input.
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechConfig } from '../lib/config/speech-config.ts';
import { listen } from '../lib/http-server.ts';
import { createObjectStorage, storageSettingsFromEnv } from '../lib/storage/object-storage.ts';
import { testBucket } from '../lib/storage/testing.ts';
import { createSynthesisService } from '../features/speech/index.ts';
import { mp3Encoder, toneEngine } from '../features/speech/testing.ts';
import { createTtsServer } from './tts.ts';

const engine = toneEngine();
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const service = createSynthesisService({
    loadEngine: async () => engine,
    encoder: mp3Encoder(),
    storage: createObjectStorage(storageSettingsFromEnv()),
    config: speechConfig,
  });
  server = createTtsServer(service);
  baseUrl = `http://127.0.0.1:${await listen(server, 0)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  vi.restoreAllMocks();
});

const valid = {
  key: 'speech/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3',
  text: 'take off',
  voice: speechConfig.voice,
  modelRevision: speechConfig.modelRevision,
  encodingVersion: speechConfig.encoding.version,
};

const hostileKeys = [
  ['an article object', 'articles/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3'],
  ['a path that climbs out', 'speech/../articles/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3'],
  ['an absolute path', '/etc/passwd'],
  ['a key that is not a UUID', 'speech/take-off.mp3'],
  ['another prefix', 'models/supertonic-3/onnx/vocoder.onnx'],
  ['another smoke object', 'smoke/../speech/check.mp3'],
  ['a URL', 'https://evil.example/x.mp3'],
  ['an encoded slash', 'speech%2F0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3'],
  ['a key with a line break', 'smoke/check.mp3\nspeech/x.mp3'],
  ['an empty key', ''],
  ['a number', 12],
] as const;

const hostileBodies: [string, unknown][] = [
  ...hostileKeys.map(([name, key]): [string, unknown] => [name, { ...valid, key }]),
  ['text of 301 characters', { ...valid, text: 'a'.repeat(301) }],
  ['text of 10 000 characters', { ...valid, text: 'word '.repeat(2000).trim() }],
  ['empty text', { ...valid, text: '' }],
  ['text that is only spaces', { ...valid, text: '   ' }],
  ['text that is not normalized', { ...valid, text: 'take\n\noff' }],
  ['text that is not a string', { ...valid, text: ['take', 'off'] }],
  ['an extra field', { ...valid, ownerId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d' }],
  ['a prototype key', JSON.parse(`{"__proto__":{"key":"smoke/check.mp3"}}`)],
  ['no body', ''],
  ['text that is not JSON', 'key=smoke/check.mp3'],
  ['an array', [valid]],
];

describe('POST /synthesize with hostile input', () => {
  it.each(hostileBodies)('refuses %s with 422 and writes nothing', async (_, body) => {
    const response = await fetch(`${baseUrl}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

    const text = await response.text();
    expect(response.status).toBe(422);
    expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
    expect(text).not.toContain('evil.example');
    expect(text).not.toContain('word word');
    expect(text.length).toBeLessThan(2000);
    expect(engine.texts).toEqual([]);
  });

  it('refuses a body over the size limit', async () => {
    const response = await fetch(`${baseUrl}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...valid, text: 'a'.repeat(100_000) }),
    });

    expect(response.status).toBe(422);
    expect(engine.texts).toEqual([]);
  });

  it('wrote no object for any refused key', async () => {
    expect(await testBucket().has('speech/take-off.mp3')).toBe(false);
    expect(await testBucket().has('articles/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3')).toBe(false);
  });
});
