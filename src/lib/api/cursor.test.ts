import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, PAGE_SIZE, takePage } from './cursor.ts';

describe('encodeCursor and decodeCursor', () => {
  it('give back the keys of the same scope from an opaque URL-safe string', () => {
    const keys = ['2026-11-22T09:04:00.000Z', null, 3, true, 'a1'];
    const cursor = encodeCursor('articles:collected:desc', keys);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor('articles:collected:desc', cursor, 5)).toEqual(keys);
  });

  it('refuse a cursor of another scope, with another key count, or that is not a cursor', () => {
    const cursor = encodeCursor('articles:collected:desc', ['2026-11-22', 'a1']);
    const invalid = expect.objectContaining({ code: 'INVALID_INPUT' });

    expect(() => decodeCursor('articles:article:asc', cursor, 2)).toThrow(invalid);
    expect(() => decodeCursor('articles:collected:desc', cursor, 3)).toThrow(invalid);
    for (const bad of ['', 'not a cursor', 'e30', Buffer.from('[1]').toString('base64url')]) {
      expect(() => decodeCursor('articles:collected:desc', bad, 2)).toThrow(invalid);
    }
    const objectKey = Buffer.from(JSON.stringify({ s: 'x', k: [{}] })).toString('base64url');
    expect(() => decodeCursor('x', objectKey, 1)).toThrow(invalid);
  });
});

describe('takePage', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `a${i}` }));
  const keys = (row: { id: string }) => [row.id];

  it('sends a batch of 20 and a cursor after the last one when there are more rows', () => {
    const page = takePage(rows(PAGE_SIZE + 1), 'scope', keys);

    expect(PAGE_SIZE).toBe(20);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor('scope', page.nextCursor ?? '', 1)).toEqual(['a19']);
  });

  it('has no cursor at the end of the list', () => {
    expect(takePage(rows(PAGE_SIZE), 'scope', keys).nextCursor).toBeNull();
    expect(takePage([], 'scope', keys)).toEqual({ items: [], nextCursor: null });
  });
});
