// SHA-256 digests the tables store (.docs/design/data.md): body, URL, context and content
// hashes, audio cache keys and the request digests of operation receipts.
import { createHash } from 'node:crypto';

/** SHA-256 of the UTF-8 text, in lower-case hex. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalValue(item)));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => [key, canonicalValue(item)]);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * JSON with the keys of every object in sorted order and undefined fields left out, so two
 * requests with the same content give the same text whatever order their fields came in.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value)) ?? 'null';
}

/** The digest of a request's content, as operation receipts compare it. */
export function requestDigest(request: unknown): string {
  return sha256Hex(canonicalJson(request));
}
