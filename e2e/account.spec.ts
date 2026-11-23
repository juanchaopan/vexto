import { clerkSetup } from '@clerk/testing/playwright';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { ensureClerkUser, signInAndOpen, testEmail } from './support/clerk.ts';
import { acceptedTermsVersion, forgetMember, inviteMember } from './support/members.ts';

// Signing in, the member and terms gates, and the account menu (.docs/design/screens.md, 01–04,
// 51 and 62), against the Clerk development instance in Clerk's testing mode. What a visitor
// without a session gets is in sign-in.spec.ts.

// Signing in takes a good part of the default 30 seconds, and the first page after signing in
// asks the server for the member's profile before it shows anything; with every test file
// running side by side in both browsers, those requests can take several seconds, so the tests
// have more room than the defaults and run one after another in one worker per browser.
test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

test.beforeAll(async () => {
  test.setTimeout(120_000);
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
  await expect(signInPage.getByRole('heading', { name: 'Sign in to vexto' })).toBeVisible();
  await expect(signInPage.getByRole('button', { name: /Continue with Google/ })).toBeVisible();

  const page = await signInAndOpen(signInPage, email, '/');

  await expect(page.getByRole('heading', { name: 'Terms of use' })).toBeVisible();
  await expect(page.getByText('Please read and accept these terms to use vexto.')).toBeVisible();
  await page.getByRole('button', { name: 'I agree' }).click();

  await expect(articlesTitle(page)).toBeVisible();
  expect(await acceptedTermsVersion(email)).toBe(1);

  // A path ID with a dot in it still reaches its Route Handler with the session, which finds no
  // such card.
  const dotted = await page.request.get('/api/vocabulary/not-a-card.json');
  expect(dotted.status()).toBe(404);
  expect(await dotted.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });

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
