import { describe, expect, it } from 'vitest';
import { ApiError } from './errors.ts';
import { dataResult, errorResponse, listResult, noContentResult, sendResult } from './responses.ts';

describe('sendResult', () => {
  it('sends the body as JSON that no cache may keep', async () => {
    const response = sendResult(dataResult({ id: 'a1' }, 201));

    expect(response.status).toBe(201);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: { id: 'a1' } });
  });

  it('sends a 204 without content', async () => {
    const response = sendResult(noContentResult());

    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });
});

describe('dataResult and listResult', () => {
  it('wrap the data, with meta only for lists', () => {
    expect(dataResult({ ok: true })).toEqual({ status: 200, body: { data: { ok: true } } });
    expect(listResult([{ id: 'a1' }], { nextCursor: null, totalCount: 1 })).toEqual({
      status: 200,
      body: { data: [{ id: 'a1' }], meta: { nextCursor: null, totalCount: 1 } },
    });
  });
});

describe('errorResponse', () => {
  it('answers with the status of the code and the error body', async () => {
    const response = errorResponse(new ApiError('TERMS_REQUIRED', 'Accept the terms.'), 'req_9');

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: {
        code: 'TERMS_REQUIRED',
        message: 'Accept the terms.',
        retryable: false,
        requestId: 'req_9',
      },
    });
  });
});
