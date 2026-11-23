// Responses of the web application's HTTP interface (.docs/design/interfaces.md, 请求和响应):
// JSON with `Cache-Control: no-store`; success bodies are { data } and, for lists,
// { data, meta: { nextCursor, totalCount } }; a 204 has no body.
import { errorBody, type ApiError } from './errors.ts';

const noStore = { 'Cache-Control': 'no-store' };

/** A status and body, as a handler produces it and an operation receipt stores it. */
export type ApiResult = { status: number; body?: unknown };

export type ListMeta = { nextCursor: string | null; totalCount: number };

/** Sends a result: as JSON, or with no content for a 204 or a result without a body. */
export function sendResult({ status, body }: ApiResult): Response {
  if (status === 204 || body === undefined) {
    return new Response(null, { status, headers: noStore });
  }
  return Response.json(body, { status, headers: noStore });
}

/** A success result whose body is { data }; 200 unless another status is given. */
export function dataResult(data: unknown, status = 200): ApiResult {
  return { status, body: { data } };
}

/** A list batch: { data, meta } with the cursor of the next batch, null at the end. */
export function listResult(data: readonly unknown[], meta: ListMeta): ApiResult {
  return { status: 200, body: { data, meta } };
}

/** The 204 result of a delete. */
export function noContentResult(): ApiResult {
  return { status: 204 };
}

export function errorResponse(error: ApiError, requestId: string): Response {
  return sendResult({ status: error.status, body: errorBody(error, requestId) });
}
