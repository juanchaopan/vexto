import { expect, test } from '@playwright/test';

test(
  'health check reports the service as up',
  { tag: ['@smoke', '@production-safe'] },
  async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^application\/json/);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', service: 'vexto' });
  },
);

test('health check answers HEAD like GET without a body', async ({ request }) => {
  const response = await request.head('/api/health');

  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect((await response.body()).length).toBe(0);
});

test('health check answers other methods with 405', async ({ request }) => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await request.fetch('/api/health', { method });

    expect(response.status(), method).toBe(405);
  }
});
