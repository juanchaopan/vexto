// Keyset cursors of the lists, 20 items per batch (.docs/design/interfaces.md): a cursor holds the
// sort values and ID of the last item sent, so the next batch starts right after it. To the
// client a cursor is an opaque base64url string. It also carries the list's scope, such as the
// sort and direction it was made for, so a cursor from one query is refused by another.
//
// Times go into a cursor as text with microseconds, as PostgreSQL holds them: a JavaScript Date
// keeps only milliseconds, and a cursor rounded to them would skip rows that differ below that.
import { z } from 'zod';
import { ApiError } from './errors.ts';

/** Every list sends this many items per batch; the client cannot change it. */
export const PAGE_SIZE = 20;

/** A sort value in a cursor; times are written as ISO strings, a missing value as null. */
export type CursorValue = string | number | boolean | null;

type CursorPayload = { s: string; k: CursorValue[] };

/** A time as a cursor holds it: UTC ISO 8601 with six fractional digits. */
export const microsecondTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine((text) => !Number.isNaN(Date.parse(text)));

/** The INVALID_INPUT of a cursor that is not one of this list, or whose keys are not valid. */
export function invalidCursor(): never {
  throw new ApiError('INVALID_INPUT', 'The cursor is not valid for this list.');
}

function isCursorValue(value: unknown): value is CursorValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/** The cursor that continues after an item with these keys, in the list of that scope. */
export function encodeCursor(scope: string, keys: readonly CursorValue[]): string {
  const payload: CursorPayload = { s: scope, k: [...keys] };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function parsePayload(cursor: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The keys a cursor holds, or INVALID_INPUT when it is not a cursor of this scope with exactly
 * `keyCount` keys.
 */
export function decodeCursor(scope: string, cursor: string, keyCount: number): CursorValue[] {
  const payload = parsePayload(cursor);
  if (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as CursorPayload).s === scope &&
    Array.isArray((payload as CursorPayload).k) &&
    (payload as CursorPayload).k.length === keyCount &&
    (payload as CursorPayload).k.every(isCursorValue)
  ) {
    return (payload as CursorPayload).k;
  }
  return invalidCursor();
}

export type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * One batch from rows read with a limit of PAGE_SIZE + 1: the first PAGE_SIZE rows, and a cursor
 * after the last of them when the extra row shows there is more.
 */
export function takePage<T>(
  rows: readonly T[],
  scope: string,
  keysOf: (row: T) => readonly CursorValue[],
): Page<T> {
  const items = rows.slice(0, PAGE_SIZE);
  const last = items.at(-1);
  const nextCursor =
    rows.length > PAGE_SIZE && last !== undefined ? encodeCursor(scope, keysOf(last)) : null;
  return { items, nextCursor };
}
