import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../lib/api/errors.ts';
import {
  bulkDeleteRequest,
  cardExamplePath,
  cardPathId,
  replaceRequest,
  vocabularyListRequest,
} from './vocabulary-request.ts';

const params = (text: string) => new URLSearchParams(text);

function invalidInput(work: () => unknown) {
  expect(work).toThrowError(
    expect.objectContaining({ code: 'INVALID_INPUT' }) as unknown as ApiError,
  );
}

describe('vocabularyListRequest', () => {
  it('takes every card by word, ascending, without parameters', () => {
    expect(vocabularyListRequest(params(''))).toEqual({
      query: {
        state: 'all',
        q: '',
        rounds: { speak: [], spell: [], translate: [] },
        sort: 'word',
        direction: 'asc',
      },
      cursor: undefined,
    });
  });

  it('reads the tab, the trimmed search, the repeatable round filters, the sort and the cursor', () => {
    const request = vocabularyListRequest(
      params(
        'state=ongoing&q=%20run%20&rounds.spell=complete&rounds.spell=2&rounds.translate=1&sort=spellNext&direction=desc&cursor=abc',
      ),
    );

    expect(request).toEqual({
      query: {
        state: 'ongoing',
        q: 'run',
        rounds: { speak: [], spell: ['2', 'complete'], translate: ['1'] },
        sort: 'spellNext',
        direction: 'desc',
      },
      cursor: 'abc',
    });
  });

  it('takes every round of a mode as no filter', () => {
    const every = ['1', '2', '3', '4', '5', '6', '7', 'complete']
      .map((round) => `rounds.speak=${round}`)
      .join('&');
    expect(vocabularyListRequest(params(every)).query.rounds.speak).toEqual([]);
  });

  it('refuses unknown names and values, repeated single values and long or NUL searches', () => {
    invalidInput(() => vocabularyListRequest(params('tab=all')));
    invalidInput(() => vocabularyListRequest(params('state=done')));
    invalidInput(() => vocabularyListRequest(params('rounds.spell=0')));
    invalidInput(() => vocabularyListRequest(params('rounds.listen=1')));
    invalidInput(() => vocabularyListRequest(params('sort=next')));
    invalidInput(() => vocabularyListRequest(params('direction=asc&direction=desc')));
    invalidInput(() => vocabularyListRequest(params(`q=${'a'.repeat(101)}`)));
    invalidInput(() => vocabularyListRequest(params('q=a%00b')));
  });
});

describe('the write bodies', () => {
  it('take a replacement with the card time DUPLICATE_WORD gave', () => {
    const body = {
      operationId: randomUUID(),
      lookupId: randomUUID(),
      updatedAt: '2026-11-23T10:00:00.123Z',
    };
    expect(replaceRequest.parse(body)).toEqual(body);
    expect(replaceRequest.safeParse({ ...body, updatedAt: 'yesterday' }).success).toBe(false);
  });

  it('take a batch of 1 to 100 different IDs', () => {
    const id = randomUUID();
    expect(bulkDeleteRequest.safeParse({ operationId: id, ids: [id] }).success).toBe(true);
    expect(bulkDeleteRequest.safeParse({ operationId: id, ids: [] }).success).toBe(false);
    expect(
      bulkDeleteRequest.safeParse({ operationId: id, ids: [id, id.toUpperCase()] }).success,
    ).toBe(false);
    expect(
      bulkDeleteRequest.safeParse({
        operationId: id,
        ids: Array.from({ length: 101 }, () => randomUUID()),
      }).success,
    ).toBe(false);
  });
});

describe('the path IDs', () => {
  it('are read as lower-case UUIDs', () => {
    const id = randomUUID();
    expect(cardPathId(id.toUpperCase())).toBe(id);
    expect(cardExamplePath({ id, exampleId: id })).toEqual({ cardId: id, exampleId: id });
  });

  it('name no card when they are not UUIDs', () => {
    expect(() => cardPathId('1 or 1=1')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }) as unknown as ApiError,
    );
    expect(() => cardExamplePath({ id: randomUUID(), exampleId: 'x' })).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }) as unknown as ApiError,
    );
  });
});
