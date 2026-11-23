import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from './errors.ts';
import { dataResult } from './responses.ts';
import { handleRequest, newRequestId, parseInput, readJsonBody } from './route.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('newRequestId', () => {
  it('makes a new prefixed ID every time', () => {
    const id = newRequestId();

    expect(id).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(newRequestId()).not.toBe(id);
  });
});

describe('handleRequest', () => {
  it('sends what the handler returns', async () => {
    const response = await handleRequest(async () => dataResult({ id: 'a1' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: 'a1' } });
  });

  it('answers an ApiError with its code and the request ID', async () => {
    let seen = '';
    const response = await handleRequest(async ({ requestId }) => {
      seen = requestId;
      throw new ApiError('NOT_FOUND', 'No such article.');
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'No such article.', retryable: false, requestId: seen },
    });
  });

  it('logs any other error by name under the request ID and answers INTERNAL without its message', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    const response = await handleRequest(async () => {
      throw new Error('connection refused to db.internal');
    });
    const body = (await response.json()) as { error: Record<string, unknown> };

    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({
      code: 'INTERNAL',
      message: 'The request failed unexpectedly.',
      retryable: true,
    });
    expect(JSON.stringify(body)).not.toContain('db.internal');
    expect(JSON.parse(lines[0])).toMatchObject({
      severity: 'ERROR',
      requestId: body.error.requestId,
      error: { name: 'Error' },
    });
    expect(lines[0]).not.toContain('db.internal');
  });
});

const schema = z.strictObject({ operationId: z.uuid() });

describe('parseInput', () => {
  it('returns the valid input', () => {
    const input = { operationId: '0b6f3c1e-8a51-4a4c-9d76-0f3e8f0b2a11' };

    expect(parseInput(schema, input)).toEqual(input);
  });

  it('refuses invalid input and unknown fields as INVALID_INPUT', () => {
    expect(() => parseInput(schema, { operationId: 'x' })).toThrow(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        message: expect.stringMatching(/operationId/),
      }),
    );
    expect(() =>
      parseInput(schema, { operationId: '0b6f3c1e-8a51-4a4c-9d76-0f3e8f0b2a11', extra: 1 }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
});

describe('readJsonBody', () => {
  const post = (body: string) => new Request('http://localhost/api/x', { method: 'POST', body });

  it('reads and validates a JSON body', async () => {
    const body = { operationId: '0b6f3c1e-8a51-4a4c-9d76-0f3e8f0b2a11' };

    expect(await readJsonBody(post(JSON.stringify(body)), schema)).toEqual(body);
  });

  it('refuses a body that is not JSON, and an empty body the schema does not allow', async () => {
    await expect(readJsonBody(post('{'), schema)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'The request body is not JSON.',
    });
    await expect(readJsonBody(post(''), schema)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await readJsonBody(post(''), z.undefined())).toBeUndefined();
  });
});
