import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../lib/api/errors.ts';
import { lookupRequest, refreshPath } from './lookup-request.ts';

const id = '0b5f8a2e-3c1d-4e6f-8a9b-1c2d3e4f5a6b';

function valid(context: unknown, selection: unknown = { start: 0, end: 4 }) {
  return lookupRequest.safeParse({ operationId: id, context, selection }).success;
}

describe('lookupRequest', () => {
  it('takes every kind of context by IDs', () => {
    expect(valid({ kind: 'article', articleId: id, firstSentence: 2, lastSentence: 3 })).toBe(true);
    expect(valid({ kind: 'lookup-example', lookupId: id, exampleId: id })).toBe(true);
    expect(valid({ kind: 'vocabulary-example', cardId: id, exampleId: id })).toBe(true);
    expect(valid({ kind: 'spell-example', cardId: id, exampleId: id })).toBe(true);
  });

  it('refuses text in place of IDs and fields of another kind', () => {
    expect(
      valid({ kind: 'article', articleId: id, firstSentence: 0, lastSentence: 0, text: 'x' }),
    ).toBe(false);
    expect(valid({ kind: 'lookup-example', lookupId: id, exampleId: id, cardId: id })).toBe(false);
    expect(valid({ kind: 'lookup-example', lookupId: 'a-word', exampleId: id })).toBe(false);
  });

  it('wants the sentences in order and no more of them than a selection can touch', () => {
    const article = { kind: 'article', articleId: id };
    expect(valid({ ...article, firstSentence: 3, lastSentence: 2 })).toBe(false);
    expect(valid({ ...article, firstSentence: 0, lastSentence: 7 })).toBe(true);
    expect(valid({ ...article, firstSentence: 0, lastSentence: 8 })).toBe(false);
  });

  it('wants whole, non-negative offsets', () => {
    const context = { kind: 'lookup-example', lookupId: id, exampleId: id };
    expect(valid(context, { start: -1, end: 4 })).toBe(false);
    expect(valid(context, { start: 0.5, end: 4 })).toBe(false);
    expect(valid(context, { start: '0', end: 4 })).toBe(false);
    expect(valid(context, { start: 0, end: 4, text: 'word' })).toBe(false);
  });
});

describe('refreshPath', () => {
  it('gives the IDs of a refresh path', () => {
    expect(refreshPath({ id, exampleId: id })).toEqual({ lookupId: id, exampleId: id });
  });

  it('names nothing when an ID is not a UUID', () => {
    expect(() => refreshPath({ id: 'abc', exampleId: id })).toThrow(ApiError);
  });
});
