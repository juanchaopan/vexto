import { expect, test } from '@playwright/test';

// What a visitor without a session gets: the sign-in page and refused interface requests. The
// first two are smoke tests that only read, so they also run against production: the first shows
// that the deployed application reaches Clerk with its keys, the second that its session check
// guards the interface. Clerk's sign-in component is loaded from Clerk's servers when the page
// opens.

const CLERK_LOAD_TIMEOUT = 20_000;

test(
  'a visitor without a session is sent to the sign-in page',
  { tag: ['@smoke', '@production-safe'] },
  async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('heading', { name: 'Sign in to vexto' })).toBeVisible({
      timeout: CLERK_LOAD_TIMEOUT,
    });
    await expect(page.getByText('Welcome! Please sign in to continue.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible();
  },
);

test(
  'the interface refuses a request without a session',
  { tag: ['@smoke', '@production-safe'] },
  async ({ request }) => {
    const response = await request.get('/api/me');

    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  },
);

test('the interface refuses a path with a dot in its last segment without a session', async ({
  request,
}) => {
  const response = await request.get('/api/vocabulary/not-a-card.json');

  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
});
