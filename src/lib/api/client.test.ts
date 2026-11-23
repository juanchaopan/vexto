import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiRequestError, apiRequest, dataBody, hasErrorCode, offersRetry } from './client.ts';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

const profile = dataBody(z.object({ email: z.string() }));

function respond(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  fetchMock.mockResolvedValueOnce(new Response(text, { status }));
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as ApiRequestError;
  }
  throw new Error('The request did not fail.');
}

describe('apiRequest', () => {
  it('returns the success body checked against the schema', async () => {
    respond(200, { data: { email: 'ann@example.com' } });

    await expect(apiRequest('/api/me', profile)).resolves.toEqual({
      data: { email: 'ann@example.com' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'GET', body: undefined, cache: 'no-store' }),
    );
  });

  it('sends a body as JSON', async () => {
    respond(200, { data: { email: 'ann@example.com' } });

    await apiRequest('/api/terms/acceptance', profile, { method: 'POST', body: { version: 1 } });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/terms/acceptance',
      expect.objectContaining({
        method: 'POST',
        body: '{"version":1}',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('reads the code, retryable and details of an error body', async () => {
    respond(409, {
      error: {
        code: 'SELECTION_CHANGED',
        message: 'Some words changed.',
        retryable: false,
        requestId: 'req_1',
        details: { missingIds: ['a'] },
      },
    });

    const error = await failure(apiRequest('/api/vocabulary', profile));

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      code: 'SELECTION_CHANGED',
      status: 409,
      retryable: false,
      details: { missingIds: ['a'] },
    });
  });

  it('reads a page that is not the error body by its status', async () => {
    respond(502, '<html>Bad gateway</html>');
    expect(await failure(apiRequest('/api/me', profile))).toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
    });

    respond(500, '');
    expect(await failure(apiRequest('/api/me', profile))).toMatchObject({
      code: 'INTERNAL',
      retryable: true,
    });
  });

  it('calls a request without a response NO_RESPONSE', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await failure(apiRequest('/api/me', profile))).toMatchObject({
      code: 'NO_RESPONSE',
      status: null,
      retryable: true,
    });
  });

  it('passes an abort on as it is', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    const error = await failure(apiRequest('/api/me', profile, { signal: controller.signal }));

    expect(error).toBeInstanceOf(DOMException);
  });

  it('treats a success body of the wrong shape as INTERNAL', async () => {
    respond(200, { data: { name: 'Ann' } });

    expect(await failure(apiRequest('/api/me', profile))).toMatchObject({
      code: 'INTERNAL',
      retryable: false,
    });
  });
});

describe('hasErrorCode', () => {
  it('matches an ApiRequestError by its code', () => {
    const error = new ApiRequestError('TERMS_REQUIRED', 403, false);

    expect(hasErrorCode(error, 'NOT_A_MEMBER', 'TERMS_REQUIRED')).toBe(true);
    expect(hasErrorCode(error, 'NOT_FOUND')).toBe(false);
    expect(hasErrorCode(new Error('TERMS_REQUIRED'), 'TERMS_REQUIRED')).toBe(false);
  });
});

describe('offersRetry', () => {
  it('offers Retry for server errors, unavailable services and no response', () => {
    expect(offersRetry(new ApiRequestError('INTERNAL', 500, true))).toBe(true);
    expect(offersRetry(new ApiRequestError('UNAVAILABLE', 503, true))).toBe(true);
    expect(offersRetry(new ApiRequestError('NO_RESPONSE', null, true))).toBe(true);
  });

  it('does not offer Retry for answers that repeating cannot change', () => {
    expect(offersRetry(new ApiRequestError('INVALID_INPUT', 422, false))).toBe(false);
    expect(offersRetry(new ApiRequestError('NOT_FOUND', 404, false))).toBe(false);
    expect(offersRetry(new Error('offline'))).toBe(false);
  });
});
