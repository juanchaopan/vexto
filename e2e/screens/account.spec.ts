import { expect as baseExpect, test, type Page } from '@playwright/test';
import { forgetMember, inviteMember, setTermsAcceptance } from '../support/members.ts';
import {
  acceptTermsLikeDemo,
  captureScreen,
  demoAccount,
  expectShell,
  failRequests,
  settleScreen,
  signedOutPage,
  UNAVAILABLE,
  withDemoCounts,
  withDemoDay,
  type DemoAccount,
} from '../support/screens.ts';

// Signing in, the member and terms gates, the license and the account menu in their confirmed
// states (.docs/design/screens, 01–04, 51, 61 and 62).

test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

let account: DemoAccount;
let page: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  account = await demoAccount(browser, testInfo, 'account');
  page = account.page;
});

test.afterEach(async () => {
  await settleScreen(page);
});

test.afterAll(async () => {
  await account?.close();
});

test('01 the sign-in page', async ({ browser }, testInfo) => {
  const signIn = await signedOutPage(browser, testInfo);
  await signIn.goto('/sign-in');
  await expect(signIn.getByRole('heading', { name: 'Sign in to vexto' })).toBeVisible();
  await expect(signIn.getByRole('button', { name: /Continue with Google/ })).toBeVisible();
  // Clerk draws the sign-in card from its own servers, in the version it currently ships.
  await captureScreen(signIn, '01-sign-in', { mask: [signIn.locator('.cl-rootBox')] });
  await signIn.context().close();
});

test('03 and 61 the terms to accept, and accepting them failing', async () => {
  await setTermsAcceptance(account.email, null);
  try {
    await withDemoCounts(account.email);
    await account.open('/');
    await expect(page.getByRole('heading', { name: 'Terms of use' })).toBeVisible();
    await captureScreen(page, '03-terms');

    await failRequests(page, '**/api/terms/acceptance', UNAVAILABLE);
    await page.getByRole('button', { name: 'I agree' }).click();
    await expect(page.getByText("Couldn't save your answer.")).toBeVisible();
    await captureScreen(page, '61-terms-accept-failed');
  } finally {
    await acceptTermsLikeDemo(account.email);
  }
});

test('04 the license', async () => {
  await withDemoCounts(account.email);
  await account.open('/');
  await expectShell(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'License' }).click();
  await expect(page.getByRole('heading', { name: 'License', exact: true })).toBeVisible();
  await captureScreen(page, '04-license');
});

// The page's clock shows the demo's day from here on, for the acceptance date of the terms.
test('51 and 62 the account menu, and the terms read from it', async () => {
  await withDemoDay(page, account.email);
  await account.open('/');
  await expectShell(page);
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await captureScreen(page, '51-account-menu');

  await page.getByRole('button', { name: 'Terms' }).click();
  await expect(page.getByText('Accepted Nov 22.')).toBeVisible();
  await captureScreen(page, '62-terms-read-only');
});

test('02 a Google account that is not on the invitation list', async () => {
  await forgetMember(account.email);
  try {
    await account.open('/');
    await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
    await expect(
      page.getByText(`${account.email} isn't on the vexto invitation list.`),
    ).toBeVisible();
    await captureScreen(page, '02-not-a-member');
  } finally {
    await inviteMember(account.email);
    await acceptTermsLikeDemo(account.email);
  }
});
