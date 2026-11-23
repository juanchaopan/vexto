import type { Server } from 'node:http';
import { connect } from 'node:net';
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
  let port: number;
  let baseUrl: string;

  /** A body JSON cannot hold, as it refers to itself. */
  function circularBody() {
    const body: Record<string, unknown> = {};
    body.self = body;
    return body;
  }

  beforeAll(async () => {
    server = createJsonServer({
      'POST /echo': echo,
      'GET /empty': () => ({ status: 204 }),
      'GET /broken': () => {
        throw new Error('boom');
      },
      'GET /unwritable': () => ({ status: 200, body: circularBody() }),
    });
    port = await listen(server, 0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function post(body: string) {
    return fetch(`${baseUrl}/echo`, { method: 'POST', body });
  }

  /**
   * Sends a GET for the target exactly as written, which fetch would refuse or tidy, and reads
   * the answer. HTTP/1.0 keeps the answer in one piece, without chunks, up to the connection's end.
   */
  function rawGet(target: string): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(`GET ${target} HTTP/1.0\r\nHost: localhost\r\n\r\n`);
      });
      let received = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        received += chunk;
      });
      socket.on('error', reject);
      socket.on('end', () => {
        const bodyStart = received.indexOf('\r\n\r\n') + 4;
        try {
          resolve({
            status: Number(received.split(' ')[1]),
            body: JSON.parse(received.slice(bodyStart)) as unknown,
          });
        } catch (error) {
          reject(error as Error);
        }
      });
    });
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

  it('answers 500 and keeps serving when an answer cannot be written', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const response = await fetch(`${baseUrl}/unwritable`);
    write.mockRestore();

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL' } });
    expect((await fetch(`${baseUrl}/empty`)).status).toBe(204);
  });

  it('refuses a request target that is not a path, and keeps serving', async () => {
    const answer = await rawGet('//[');

    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({
      error: {
        code: 'INVALID_INPUT',
        message: 'The request target is not a valid path.',
        retryable: false,
      },
    });
    expect((await fetch(`${baseUrl}/empty`)).status).toBe(204);
  });

  it('answers 404 for unknown paths and 405 for other methods on a known path', async () => {
    expect((await fetch(`${baseUrl}/missing`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/echo`)).status).toBe(405);
  });
});
