// The frame every Route Handler of the web application runs in: each request gets an ID, the
// handler's result is sent as JSON, an ApiError is answered with its code, and anything else is
// logged under the request ID and answered as INTERNAL without its message.
import type { z } from 'zod';
import { errorFields, log } from '../log.ts';
import { ApiError } from './errors.ts';
import { errorResponse, sendResult, type ApiResult } from './responses.ts';

export type RequestScope = {
  /** The ID the error body and the log entries carry, so they can be matched up. */
  requestId: string;
};

export function newRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

/** Runs a handler and turns what it returns or throws into the response. */
export async function handleRequest(
  work: (scope: RequestScope) => Promise<ApiResult>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    return sendResult(await work({ requestId }));
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error, requestId);
    }
    log('ERROR', 'The request failed unexpectedly.', { requestId, ...errorFields(error) });
    return errorResponse(new ApiError('INTERNAL', 'The request failed unexpectedly.'), requestId);
  }
}

/**
 * Validates input with a Zod schema, or throws INVALID_INPUT naming the fields that failed.
 * Request schemas are strict objects, so unknown fields are invalid input too.
 */
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
      .join('; ');
    throw new ApiError('INVALID_INPUT', `The input is invalid: ${issues}.`);
  }
  return result.data;
}

/** Reads a JSON request body and validates it; an empty body is read as undefined. */
export async function readJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await request.text();
  let value: unknown;
  try {
    value = text === '' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    throw new ApiError('INVALID_INPUT', 'The request body is not JSON.');
  }
  return parseInput(schema, value);
}
