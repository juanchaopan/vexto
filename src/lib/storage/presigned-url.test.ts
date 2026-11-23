import { afterEach, describe, expect, it, vi } from 'vitest';
import { createObjectUrls, objectUrlsFromEnv } from './presigned-url.ts';

const settings = {
  endpoint: 'https://storage.example.test',
  region: 'us-east-2',
  bucket: 'audio',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createObjectUrls', () => {
  it('signs a path-style GET of the object that expires after the given seconds', async () => {
    const url = new URL(
      await createObjectUrls(settings).getUrl(
        'speech/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3',
        600,
      ),
    );

    expect(url.origin).toBe('https://storage.example.test');
    expect(url.pathname).toBe('/audio/speech/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^test-access-key\//);
    expect(url.href).not.toContain('test-secret-key');
  });

  it('dates the signature now, so the address stops working once its seconds have passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));

    const url = new URL(await createObjectUrls(settings).getUrl('articles/a.mp3', 600));

    expect(url.searchParams.get('X-Amz-Date')).toBe('20261122T100000Z');
  });

  it('signs a different address at another time', async () => {
    const urls = createObjectUrls(settings);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
    const first = await urls.getUrl('articles/a.mp3', 600);
    vi.setSystemTime(new Date('2026-11-22T10:10:01Z'));

    expect(await urls.getUrl('articles/a.mp3', 600)).not.toBe(first);
  });
});

describe('objectUrlsFromEnv', () => {
  it('reads the bucket only when an address is asked for', async () => {
    const urls = objectUrlsFromEnv({});

    await expect(urls.getUrl('articles/a.mp3', 600)).rejects.toThrow('S3_ENDPOINT is not set');
  });
});
