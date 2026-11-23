import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import { FetchFailure, pinnedLookup } from './limited-fetch.ts';

type LookupAnswer = { error: unknown; address: string | LookupAddress[]; family?: number };

function ask(lookup: ReturnType<typeof pinnedLookup>, options: object) {
  return new Promise<LookupAnswer>((resolve) => {
    lookup('changed.example.org', options, (error, address, family) =>
      resolve({ error, address, family }),
    );
  });
}

describe('pinnedLookup', () => {
  const lookup = pinnedLookup([
    { address: '93.184.215.14', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);

  it('answers with the checked addresses, whatever the name resolves to now', async () => {
    expect(await ask(lookup, { all: true })).toEqual({
      error: null,
      address: [
        { address: '93.184.215.14', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ],
      family: undefined,
    });
    expect(await ask(lookup, {})).toEqual({ error: null, address: '93.184.215.14', family: 4 });
  });

  it('keeps to the family the connection asks for', async () => {
    expect(await ask(lookup, { family: 6 })).toEqual({
      error: null,
      address: '2606:4700:4700::1111',
      family: 6,
    });
    expect(await ask(lookup, { family: 'IPv4', all: true })).toMatchObject({
      address: [{ address: '93.184.215.14', family: 4 }],
    });
  });
});

describe('FetchFailure', () => {
  it.each([
    [new FetchFailure('timeout', 'slow'), true],
    [new FetchFailure('network', 'reset'), true],
    [new FetchFailure('http_status', '500', 500), true],
    [new FetchFailure('http_status', '503', 503), true],
    [new FetchFailure('http_status', '408', 408), true],
    [new FetchFailure('http_status', '429', 429), true],
    [new FetchFailure('http_status', '404', 404), false],
    [new FetchFailure('http_status', '410', 410), false],
    [new FetchFailure('too_large', 'big'), false],
    [new FetchFailure('address_not_allowed', 'private'), false],
    [new FetchFailure('not_https', 'http'), false],
    [new FetchFailure('too_many_redirects', 'loop'), false],
  ])('tells whether %s can succeed later', (failure, temporary) => {
    expect(failure.temporary).toBe(temporary);
  });
});
