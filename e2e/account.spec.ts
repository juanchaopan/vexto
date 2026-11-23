import { clerkSetup } from '@clerk/testing/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ensureClerkUser, signInAndOpen, testEmail } from './support/clerk.ts';
import { acceptedTermsVersion, forgetMember, inviteMember } from './support/members.ts';

// Signing in, the member and terms gates, and the account menu (.docs/design/screens.md, 01–04,
// 51 and 62), against the Clerk development instance in Clerk's testing mode.

// Clerk's sign-in component is loaded from Clerk's servers when the page opens.
const CLERK_LOAD_TIMEOUT = 20_000;

test.beforeAll(async () => {
  await clerkSetup();
});

/** The Articles screen's title; the terms also have a section headed Articles, one level down. */
function articlesTitle(page: Page) {
  return page.getByRole('heading', { name: 'Articles', level: 1 });
}

test('a member signs in, accepts the terms, and reads them again from the account menu', async ({
  page: signInPage,
}, testInfo) => {
  const email = testEmail('member', testInfo);
  await ensureClerkUser(email);
  await inviteMember(email);

  await signInPage.goto('/');
  await expect(signInPage).toHaveURL(/\/sign-in/);
  await expect(signInPage.getByRole('heading', { name: 'Sign in to vexto' })).toBeVisible({
    timeout: CLERK_LOAD_TIMEOUT,
  });
  await expect(signInPage.getByText('Welcome! Please sign in to continue.')).toBeVisible();
  await expect(signInPage.getByRole('button', { name: /Continue with Google/ })).toBeVisible();

  const page = await signInAndOpen(signInPage, email, '/');

  await expect(page.getByRole('heading', { name: 'Terms of use' })).toBeVisible();
  await expect(page.getByText('Please read and accept these terms to use vexto.')).toBeVisible();
  await page.getByRole('button', { name: 'I agree' }).click();

  await expect(articlesTitle(page)).toBeVisible();
  expect(await acceptedTermsVersion(email)).toBe(1);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Terms' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByText(/^Accepted [A-Z][a-z]{2} \d{1,2}\.$/)).toBeVisible();
  await expect(page.getByText('You accepted these terms to use vexto.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'I agree' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Close terms' }).click();
  await expect(articlesTitle(page)).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test('a Google account that is not invited sees No access and can log out', async ({
  page: signInPage,
}, testInfo) => {
  const email = testEmail('outsider', testInfo);
  await ensureClerkUser(email);
  await forgetMember(email);

  await signInPage.goto('/sign-in');
  const page = await signInAndOpen(signInPage, email, '/');

  await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
  await expect(page.getByText(`${email} isn't on the vexto invitation list.`)).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(403);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test('the license page is public and its close button goes to sign-in', async ({ page }) => {
  await page.goto('/license');

  await expect(page.getByRole('heading', { name: 'License', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'END OF TERMS AND CONDITIONS' })).toBeVisible();

  await page.getByRole('button', { name: 'Close license' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test('the interface refuses a request without a session', async ({ request }) => {
  const response = await request.get('/api/me');

  expect(response.status()).toBe(401);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
});
