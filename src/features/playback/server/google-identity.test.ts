import { describe, expect, it } from 'vitest';
import { cachedIdTokens, idTokenSourceFromEnv } from './google-identity.ts';

function jwt(expSeconds: number) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `${encode({ alg: 'RS256' })}.${encode({ exp: expSeconds })}.signature`;
}

describe('cachedIdTokens', () => {
  const start = Date.parse('2026-11-22T10:00:00Z');

  it('keeps a token until five minutes before it expires', async () => {
    let now = start;
    let fetched = 0;
    const tokens = cachedIdTokens(
      async () => {
        fetched += 1;
        return jwt(start / 1000 + 3600 * fetched);
      },
      () => new Date(now),
    );

    const first = await tokens();
    now = start + 54 * 60_000;
    expect(await tokens()).toBe(first);
    now = start + 55 * 60_000;
    expect(await tokens()).not.toBe(first);
    expect(fetched).toBe(2);
  });

  it('fetches once for requests that ask at the same time', async () => {
    let fetched = 0;
    const tokens = cachedIdTokens(
      async () => {
        fetched += 1;
        return jwt(start / 1000 + 3600);
      },
      () => new Date(start),
    );

    await Promise.all([tokens(), tokens(), tokens()]);

    expect(fetched).toBe(1);
  });

  it('fetches again after a failure', async () => {
    let fetched = 0;
    const tokens = cachedIdTokens(
      async () => {
        fetched += 1;
        if (fetched === 1) {
          throw new Error('The exchange failed.');
        }
        return jwt(start / 1000 + 3600);
      },
      () => new Date(start),
    );

    await expect(tokens()).rejects.toThrow('The exchange failed.');
    expect(await tokens()).toMatch(/\.signature$/);
  });
});

describe('idTokenSourceFromEnv', () => {
  it('sends no token when neither federation value is set, as on a development machine', async () => {
    expect(await idTokenSourceFromEnv('http://localhost:8080', {})()).toBeNull();
  });

  it('refuses a configuration with only one of the two values', () => {
    expect(() =>
      idTokenSourceFromEnv('https://tts.example', { GCP_VERCEL_PROVIDER: 'projects/1/x' }),
    ).toThrow('must be set together');
  });
});
