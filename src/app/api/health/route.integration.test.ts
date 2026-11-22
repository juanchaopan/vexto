import { describe, expect, it, vi } from 'vitest';
import { GET, OPTIONS } from './route';

// connection() needs the request scope that only the Next.js server sets up; outside it the
// handler would throw, so the test lets the call resolve the way it does for a real request.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => undefined,
}));

describe('/api/health', () => {
  it('answers GET with the service status and forbids caching', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', service: 'vexto' });
  });

  it('answers OPTIONS with 405', () => {
    const response = OPTIONS();

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
  });
});
