// Calls the web application's HTTP interface from the browser (.docs/design/interfaces.md).
// Success bodies are checked against the caller's Zod schema; failures become an ApiRequestError
// that carries the error code, so the interface reacts by code only (.docs/design/screens.md,
// 错误的显示). A request that got no response at all, such as one sent while offline, has the
// code NO_RESPONSE. Reads go through the query client and writes through writeRequest
// (./access-handling.ts), which both answer access errors by the same rule.
import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './errors.ts';

export type ClientErrorCode = ErrorCode | 'NO_RESPONSE';

export class ApiRequestError extends Error {
  readonly code: ClientErrorCode;
  /** The HTTP status, or null without a response. */
  readonly status: number | null;
  /** Whether sending the same request again can succeed. */
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(code: ClientErrorCode, status: number | null, retryable: boolean, details?: unknown) {
    super(status === null ? 'The request got no response.' : `The request failed with ${code}.`);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

/** True when the error is an ApiRequestError with one of the codes. */
export function hasErrorCode(
  error: unknown,
  ...codes: ClientErrorCode[]
): error is ApiRequestError {
  return error instanceof ApiRequestError && codes.includes(error.code);
}

/**
 * Whether the failure of an operation is shown with Retry: an unexpected server error, an
 * unavailable service or no response at all. Other codes the design does not list for the
 * operation are shown like these, without Retry (.docs/design/screens.md, 错误的显示).
 */
export function offersRetry(error: unknown): boolean {
  return hasErrorCode(error, 'INTERNAL', 'UNAVAILABLE', 'NO_RESPONSE');
}

/**
 * Whether the failure is about the person's access: signed out, no longer a member or the terms
 * not accepted. The access handling answers these for every read, sending it again or changing
 * the page, so a read shows nothing of its own for them; a write tells by leavesPage.
 */
export function isAccessError(error: unknown): boolean {
  return hasErrorCode(error, 'UNAUTHENTICATED', 'NOT_A_MEMBER', 'TERMS_REQUIRED');
}

const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]),
    retryable: z.boolean(),
    details: z.unknown().optional(),
  }),
});

/** A time in the interface: ISO 8601 with its offset. */
export const isoTime = z.iso.datetime({ offset: true });

/** A success body `{ data }` whose data has the given shape. */
export function dataBody<T extends z.ZodType>(data: T) {
  return z.object({ data });
}

/** A batch of a list: the items of the batch, the cursor of the next one and the list's total. */
export function listBody<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z.object({ nextCursor: z.string().nullable(), totalCount: z.number().int() }),
  });
}

export type ApiRequestInit = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON. */
  body?: unknown;
  signal?: AbortSignal;
};

const gatewayStatuses = new Set([502, 503, 504]);

/**
 * The error for a failed response. A body that is not the interface's error body, such as a
 * hosting platform's error page, is read by its status: a gateway failure as UNAVAILABLE and
 * anything else as INTERNAL, both worth retrying.
 */
function responseError(status: number, body: unknown): ApiRequestError {
  const parsed = errorBodySchema.safeParse(body);
  if (parsed.success) {
    const { code, retryable, details } = parsed.data.error;
    return new ApiRequestError(code, status, retryable, details);
  }
  return new ApiRequestError(
    gatewayStatuses.has(status) ? 'UNAVAILABLE' : 'INTERNAL',
    status,
    true,
  );
}

function parseJson(text: string): unknown {
  try {
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

async function send(path: string, init: ApiRequestInit) {
  const hasBody = init.body !== undefined;
  try {
    const response = await fetch(path, {
      method: init.method ?? 'GET',
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    return { status: response.status, ok: response.ok, body: parseJson(await response.text()) };
  } catch (error) {
    if (init.signal?.aborted) {
      throw error;
    }
    throw new ApiRequestError('NO_RESPONSE', null, true);
  }
}

/** Sends a request to the interface and returns its success body, checked against `schema`. */
export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init: ApiRequestInit = {},
): Promise<T> {
  const response = await send(path, init);
  if (!response.ok) {
    throw responseError(response.status, response.body);
  }
  const parsed = schema.safeParse(response.body);
  if (!parsed.success) {
    throw new ApiRequestError('INTERNAL', response.status, false);
  }
  return parsed.data;
}
