import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createJsonServer, listen, MAX_BODY_BYTES, portFromEnv } from './http-server.ts';

describe('portFromEnv', () => {
  it('uses PORT, and 8080 when it is not set', () => {
    expect(portFromEnv({ PORT: '9000' })).toBe(9000);
    expect(portFromEnv({ PORT: '0' })).toBe(0);
    expect(portFromEnv({})).toBe(8080);
    expect(portFromEnv({ PORT: '' })).toBe(8080);
  });

  it('refuses a PORT that is not a port number', () => {
    for (const value of ['-1', '80.5', 'http', '70000']) {
      expect(() => portFromEnv({ PORT: value })).toThrow('PORT must be a port number');
    }
  });
});

describe('createJsonServer', () => {
  const echo = vi.fn(({ body }: { body: unknown }) => ({ status: 200, body: { received: body } }));
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createJsonServer({
      'POST /echo': echo,
      'GET /empty': () => ({ status: 204 }),
      'GET /broken': () => {
        throw new Error('boom');
      },
    });
    baseUrl = `http://127.0.0.1:${await listen(server, 0)}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function post(body: string) {
    return fetch(`${baseUrl}/echo`, { method: 'POST', body });
  }

  it('hands the parsed JSON body to the handler and sends its answer as JSON', async () => {
    const response = await post('{"word":"serendipity"}');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ received: { word: 'serendipity' } });
  });

  it('gives the handler no body when the request has none', async () => {
    expect(await (await post('')).json()).toEqual({});
  });

  it('sends a 204 answer without content', async () => {
    const response = await fetch(`${baseUrl}/empty`);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('refuses a body that is not JSON or is too large', async () => {
    const notJson = await post('{');
    const tooLarge = await post(JSON.stringify('x'.repeat(MAX_BODY_BYTES)));

    expect(notJson.status).toBe(422);
    expect(await notJson.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(tooLarge.status).toBe(422);
  });

  it('answers 500 without details when a handler throws', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const response = await fetch(`${baseUrl}/broken`);
    write.mockRestore();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL', message: 'The request failed unexpectedly.', retryable: true },
    });
  });

  it('answers 404 for unknown paths and 405 for other methods on a known path', async () => {
    expect((await fetch(`${baseUrl}/missing`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/echo`)).status).toBe(405);
  });
});
