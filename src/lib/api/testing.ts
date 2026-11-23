// Helpers for tests of Route Handlers: building requests the way a browser sends them, and
// checking an error answer against the interface's error body (.docs/design/interfaces.md, 错误).
// Only test files import this module.
import { expect } from 'vitest';
import { ERROR_CODES, type ErrorCode } from './errors.ts';

const origin = 'http://localhost:3000';

/** A request to a path of the application with a JSON body; a string body is sent as it is. */
export function jsonRequest(path: string, body: unknown, method = 'POST'): Request {
  return new Request(`${origin}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Reads a success answer: the status and its body, which must not be cached. */
export async function readSuccess(response: Response, status = 200): Promise<unknown> {
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return response.json();
}

/** Checks that the answer is the error body with this code and the status the code has. */
export async function expectApiError(response: Response, code: ErrorCode): Promise<void> {
  const body = (await response.json()) as { error?: Record<string, unknown> };
  expect({ status: response.status, code: body.error?.code }).toEqual({
    status: ERROR_CODES[code].status,
    code,
  });
  expect(body.error).toMatchObject({
    retryable: ERROR_CODES[code].retryable,
    message: expect.any(String),
    requestId: expect.stringMatching(/^req_/),
  });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
}

/**
 * Checks the answer for a resource that does not exist or belongs to someone else: the same 404
 * in both cases, so the answer never tells whether another member's resource exists
 * (.docs/design/rules.md, 权限和数据隔离).
 */
export async function expectNotFound(response: Response): Promise<void> {
  await expectApiError(response, 'NOT_FOUND');
}
