import { clerkSetup } from '@clerk/testing/playwright';
import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test';
import { DEMO_ARTICLES, seedDemoArticles } from './support/articles.ts';
import { ensureClerkUser, signInAndOpen, testEmail } from './support/clerk.ts';
import { inviteMember } from './support/members.ts';

// Looking words up in the reader (.docs/design/screens.md, 查词) against the demo article of the
// confirmed prototype. The application calls the stand-in for OpenAI of
// e2e/support/openai-double.ts, which gives the prototype's explanations; there is no speech
// service in this run, so word audio shows as not available.

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

const explanation = (page: Page, name: string) =>
  page.getByRole('region', { name: `Explanation of ${name}` });

test('a member looks up a word, goes through its examples and looks up a word of one', async ({
  page: signInPage,
}, testInfo) => {
  const page = await memberReading(signInPage, 'lookup', testInfo);

  await page.locator('[data-sentence] span', { hasText: /^resilient$/ }).click();

  const resilient = explanation(page, 'resilient');
  await expect(resilient.getByRole('heading', { name: 'resilient', level: 2 })).toBeVisible();
  await expect(resilient.getByText('adjective')).toBeVisible();
  await expect(resilient.getByText('有韧性的；经得起损耗的')).toBeVisible();
  await expect(resilient.getByText('1 / 2')).toBeVisible();
  await expect(resilient.getByRole('button', { name: 'Previous example' })).toBeDisabled();

  await resilient.getByRole('button', { name: 'Next example' }).click();
  await expect(resilient.getByText('2 / 2')).toBeVisible();
  await expect(page.getByText('Example 2 of 2')).toBeVisible();
  await resilient.getByRole('button', { name: 'Previous example' }).click();

  await resilient.getByText('coating', { exact: true }).click();
  const coating = explanation(page, 'coating');
  await expect(coating.getByText('涂层；覆盖层')).toBeVisible();
  await expect(resilient).toHaveAttribute('inert', '');

  await coating.getByRole('button', { name: 'Close this explanation' }).click();
  await expect(coating).toHaveCount(0);
  await expect(resilient).not.toHaveAttribute('inert');

  await resilient.getByRole('button', { name: 'Play word' }).click();
  await expect(resilient.getByRole('alert')).toContainText("Audio isn't available right now.");

  await resilient.getByRole('button', { name: 'Close this explanation' }).click();
  await expect(resilient).toHaveCount(0);
});

test('the Select words helper looks up the chosen words and refuses more than eight', async ({
  page: signInPage,
}, testInfo) => {
  const page = await memberReading(signInPage, 'select-words', testInfo);

  await page.getByRole('button', { name: 'Select words for lookup' }).first().click();
  const tool = page.getByRole('dialog', { name: 'Select words' });
  await tool.getByRole('combobox', { name: 'Sentence' }).selectOption('2');
  await tool.getByRole('combobox', { name: 'From' }).selectOption('5');
  await tool.getByRole('combobox', { name: 'To' }).selectOption('6');
  await tool.getByRole('button', { name: 'Look up' }).click();

  const chosen = explanation(page, 'resilient enough');
  await expect(chosen.getByText('所选词语在当前句子中的含义')).toBeVisible();

  await page.getByRole('button', { name: 'Select words for lookup' }).first().click();
  await tool.getByRole('combobox', { name: 'Sentence' }).selectOption('1');
  await tool.getByRole('combobox', { name: 'To' }).selectOption('8');
  await tool.getByRole('button', { name: 'Look up' }).click();

  await expect(page.getByText('Select up to 8 words.')).toBeVisible();
  await expect(chosen).toBeVisible();
});
