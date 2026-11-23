import { describe, expect, it } from 'vitest';
import { isTokenFresh, tokenExpiry } from './identity-token.ts';

function jwt(claims: Record<string, unknown>) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

describe('tokenExpiry', () => {
  it('reads the exp claim of a JWT', () => {
    expect(tokenExpiry(jwt({ exp: 1_795_000_000, aud: 'https://tts.example' }))).toEqual(
      new Date(1_795_000_000_000),
    );
  });

  it.each([
    ['a token without exp', jwt({ aud: 'x' })],
    ['a token whose exp is not a number', jwt({ exp: 'soon' })],
    ['text that is not a JWT', 'not-a-token'],
    ['a JWT whose claims are not JSON', 'a.b.c'],
  ])('gives null for %s', (_, token) => {
    expect(tokenExpiry(token)).toBeNull();
  });
});

describe('isTokenFresh', () => {
  const now = new Date('2026-11-22T10:00:00Z');

  it('keeps a token with more than five minutes left', () => {
    expect(isTokenFresh(new Date('2026-11-22T10:05:01Z'), now)).toBe(true);
  });

  it('fetches again a token with five minutes or less left, or no known expiry', () => {
    expect(isTokenFresh(new Date('2026-11-22T10:05:00Z'), now)).toBe(false);
    expect(isTokenFresh(new Date('2026-11-22T09:00:00Z'), now)).toBe(false);
    expect(isTokenFresh(null, now)).toBe(false);
  });
});
