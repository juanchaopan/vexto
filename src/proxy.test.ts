import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it, vi } from 'vitest';
import { config } from './proxy.ts';

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: () => () => undefined,
  createRouteMatcher: () => () => false,
}));

const runsOn = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe('the proxy matcher', () => {
  it('runs on pages, the public pages included', () => {
    for (const url of ['/', '/articles/0b1c2d3e', '/vocabulary', '/sign-in', '/license']) {
      expect(runsOn(url), url).toBe(true);
    }
  });

  it('runs on every interface path but the health check, also one whose last segment has a dot', () => {
    for (const url of [
      '/api',
      '/api/me',
      '/api/vocabulary/abc.json',
      '/api/vocabulary/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
      '/api/articles/a.b/visit',
      '/api/healthy',
      '/api/health.json',
    ]) {
      expect(runsOn(url), url).toBe(true);
    }
  });

  it('leaves out the health check, Next.js internals and static files', () => {
    for (const url of [
      '/api/health',
      '/api/health/',
      '/_next/static/chunks/main.js',
      '/_next/image',
      '/favicon.ico',
      '/icons/play.svg',
      '/manifest.webmanifest',
    ]) {
      expect(runsOn(url), url).toBe(false);
    }
  });
});
