import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listen } from '../lib/http-server.ts';
import { createTtsServer } from './tts.ts';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createTtsServer();
  baseUrl = `http://127.0.0.1:${await listen(server, 0)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('vexto-tts', () => {
  it('answers the health check', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers synthesis requests with 501 while synthesis is not available', async () => {
    const response = await fetch(`${baseUrl}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'smoke/check.mp3', text: 'hello' }),
    });

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Speech synthesis is not available yet.',
        retryable: false,
      },
    });
  });

  it('answers unknown paths with 404 and other methods with 405', async () => {
    expect((await fetch(`${baseUrl}/speak`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/synthesize`)).status).toBe(405);
  });
});
