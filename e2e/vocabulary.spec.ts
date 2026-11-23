import { clerkSetup } from '@clerk/testing/playwright';
import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test';
import { DEMO_ARTICLES, seedDemoArticles } from './support/articles.ts';
import { ensureClerkUser, signInAndOpen, testEmail } from './support/clerk.ts';
import { inviteMember } from './support/members.ts';

// Saving looked-up words and keeping the vocabulary (.docs/design/screens.md, 保存到生词本,
// Vocabulary and 词卡详情) against the demo article of the confirmed prototype. The application
// calls the stand-in for OpenAI of e2e/support/openai-double.ts, which gives the prototype's
// explanations, says which saved meaning is the same and writes the Translate options.

// Signing in through Clerk takes a good part of the default 30 seconds, and with both browsers
// running side by side a request to the built application can take several seconds; the tests
// of this file run one after another in one worker per browser.
test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await clerkSetup();
  await seedDemoArticles();
});

const lunar = DEMO_ARTICLES[0];

/** A signed-in member who accepted the terms, reading the demo article about lunar dust. */
async function memberReading(signInPage: Page, role: string, testInfo: TestInfo) {
  const email = testEmail(role, testInfo);
  await ensureClerkUser(email);
  await inviteMember(email);
  await signInPage.goto('/sign-in');
  const page = await signInAndOpen(signInPage, email, '/license');
  const accepted = await page.request.post('/api/terms/acceptance', { data: { version: 1 } });
  expect(accepted.status()).toBe(200);
  await page.goto(`/articles/${lunar.id}`);
  await expect(page.getByRole('heading', { name: lunar.title, level: 1 })).toBeVisible();
  return page;
}

/** The explanations of a lemma, the lowest layer first. */
const explanations = (page: Page, name: string) =>
  page.getByRole('region', { name: `Explanation of ${name}` });

test('a member saves a word, replaces it with the same meaning, finds it and deletes it', async ({
  page: signInPage,
}, testInfo) => {
  const page = await memberReading(signInPage, 'vocabulary', testInfo);

  await page.locator('[data-sentence] span', { hasText: /^resilient$/ }).click();
  const first = explanations(page, 'resilient').first();
  await expect(first.getByText('有韧性的；经得起损耗的')).toBeVisible();
  await first.getByRole('button', { name: 'Add word' }).click();
  await expect(page.getByText('Saved to Vocabulary.')).toBeVisible();
  await expect(first.getByRole('button', { name: 'Saved to Vocabulary' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await first.getByRole('button', { name: 'Next example' }).click();
  await first.getByText('Resilient', { exact: true }).click();
  await expect(explanations(page, 'resilient')).toHaveCount(2);
  const nested = explanations(page, 'resilient').last();
  await expect(first).toHaveAttribute('inert', '');
  await nested.getByRole('button', { name: 'Add word' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace saved word?' });
  await expect(dialog.getByText('resilient · adjective')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText('Saved word replaced. Review progress is unchanged.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(nested.getByRole('button', { name: 'Saved to Vocabulary' })).toBeVisible();

  await page.getByRole('link', { name: /^Vocabulary/ }).click();
  await expect(page.getByRole('heading', { name: 'Vocabulary', level: 1 })).toBeVisible();
  await expect(page.getByText('1 word', { exact: true })).toBeVisible();
  await expect(page.getByText('adjective · 有韧性的；经得起损耗的')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Spell, Round 1, —' })).toBeVisible();

  const card = page.getByRole('button', { name: 'resilient', exact: true });
  await card.click();
  await expect(page.getByRole('heading', { name: 'resilient', level: 1 })).toBeVisible();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await page.getByRole('button', { name: 'Close word and return to Vocabulary' }).click();
  await expect(card).toBeFocused();

  await page.getByRole('button', { name: 'Select words' }).click();
  await page.getByRole('checkbox', { name: 'Select resilient' }).check();
  await page.getByRole('button', { name: 'Delete 1 selected words' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete word?' });
  await expect(
    confirmation.getByText('resilient. Review progress will also be deleted.'),
  ).toBeVisible();
  await confirmation.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText('1 word deleted.')).toBeVisible();
  await expect(
    page.getByText('No words yet. Select a word while reading to look it up.'),
  ).toBeVisible();
});
