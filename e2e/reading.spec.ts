import { clerkSetup } from '@clerk/testing/playwright';
import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test';
import { DEMO_ARTICLES, lengthText, seedDemoArticles, seedDemoVisits } from './support/articles.ts';
import { ensureClerkUser, signInAndOpen, testEmail } from './support/clerk.ts';
import { inviteMember } from './support/members.ts';

// The article list, the reader and the player (.docs/design/screens.md, Articles and 阅读页和
// 播放器) against the fixed demo articles: the list newest first with the member's own visits,
// the search and the Source filter, opening an article, playing it with the sentence highlight
// following the audio, the speed, a continuous play moving on to the next article, and an article
// that no longer exists.

// Signing in through Clerk takes a good part of the default 30 seconds before a test starts its
// own steps, and with both browsers running side by side in the container a request to the
// built application can take several seconds. The tests of this file run one after another in
// one worker per browser, so they leave the other workers room for the other files' tests.
test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await clerkSetup();
  await seedDemoArticles();
});

const newest = DEMO_ARTICLES[0];
const second = DEMO_ARTICLES[1];

/** A signed-in member who accepted the terms, with the demo visits, on the Articles screen. */
async function memberOnArticles(signInPage: Page, role: string, testInfo: TestInfo) {
  const email = testEmail(role, testInfo);
  await ensureClerkUser(email);
  await inviteMember(email);
  await seedDemoVisits(email);
  await signInPage.goto('/sign-in');
  const page = await signInAndOpen(signInPage, email, '/license');
  const accepted = await page.request.post('/api/terms/acceptance', { data: { version: 1 } });
  expect(accepted.status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Articles', level: 1 })).toBeVisible();
  return page;
}

const card = (page: Page, title: string) => page.locator('article').filter({ hasText: title });

const cardTitle = (page: Page, title: string) =>
  card(page, title).getByRole('button', { name: title, exact: true });

const playerOf = (page: Page) => page.getByRole('region', { name: 'Article player' });

/**
 * Waits until the article plays. A browser that refuses to start audio without a tap shows Tap
 * to continue, which is pressed as a person would.
 */
async function expectPlaying(page: Page) {
  const pause = playerOf(page).getByRole('button', { name: 'Pause article' });
  const tap = playerOf(page).getByRole('button', { name: 'Tap to continue' });
  await expect(pause.or(tap)).toBeVisible();
  if (await tap.isVisible()) {
    await tap.click();
  }
  await expect(pause).toBeVisible();
}

test('a member browses the list, reads an article and plays it', async ({
  page: signInPage,
}, testInfo) => {
  const page = await memberOnArticles(signInPage, 'reader', testInfo);

  await expect(page.getByText(/^\d+ articles$/)).toBeVisible();
  const first = page.locator('article').first();
  await expect(first.getByRole('button', { name: newest.title, exact: true })).toBeVisible();
  await expect(first.getByText(newest.paragraphs[0][0])).toBeVisible();
  await expect(first.getByText(/^Collected Nov 22(, 2026)?, 09:04$/)).toBeVisible();
  await expect(first.getByText(/^Last visited Nov 22(, 2026)?, 09:40$/)).toBeVisible();
  await expect(card(page, second.title).getByText(/Last visited/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();

  const search = page.getByRole('textbox', { name: 'Search article text' });
  await search.fill('satellites');
  await search.press('Enter');
  await expect(card(page, 'Small satellites test a folding antenna in orbit')).toBeVisible();
  await expect(
    card(page, 'Robotic arm practices refueling a satellite on the ground'),
  ).toBeVisible();
  await expect(page.getByText('2 articles')).toBeVisible();
  await expect(page.getByText('All loaded')).toBeVisible();

  await search.fill('');
  await search.press('Enter');
  await expect(page.getByText(/^\d+ articles$/)).not.toHaveText('2 articles');
  await page.getByRole('button', { name: 'Filter Source' }).click();
  await page.getByRole('checkbox', { name: 'NIST News' }).check();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: 'Filter Source, NIST News' })).toBeVisible();
  await expect(page.getByText('5 articles')).toBeVisible();
  await expect(page.locator('article').filter({ hasNotText: 'NIST News' })).toHaveCount(0);

  const article = DEMO_ARTICLES.find((one) => one.feed === 'nist-news')!;
  await cardTitle(page, article.title).click();
  await expect(page).toHaveURL(new RegExp(`/articles/${article.id}$`));
  await expect(page.getByRole('heading', { name: article.title, level: 1 })).toBeVisible();
  await expect(page.getByText(lengthText(article))).toBeVisible();
  await expect(page.getByRole('link', { name: 'Original' })).toBeVisible();

  const playback = page.waitForResponse(
    (response) => response.url().endsWith('/api/media/playback') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Play article' }).first().click();
  await playback;
  await expectPlaying(page);
  await expect(page.locator('[data-sentence-row][data-active]')).toHaveCount(1);

  // Choosing a speed closes the panel at once, so the choice is a press, not a checked state.
  await page.getByRole('button', { name: 'Playback speed, 1×' }).click();
  await page.getByRole('radio', { name: '1.5×' }).click();
  await expect(page.getByRole('button', { name: 'Playback speed, 1.5×' })).toBeVisible();

  await page.getByRole('button', { name: 'Articles', exact: true }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page, article.title).getByText(/Last visited/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter Source, NIST News' })).toBeVisible();
});

test('a continuous play opens the next article through the list', async ({
  page: signInPage,
}, testInfo) => {
  const page = await memberOnArticles(signInPage, 'listener', testInfo);

  await page.getByRole('button', { name: 'Play all articles' }).click();
  await expect(page).toHaveURL(new RegExp(`/articles/${newest.id}$`));
  await expectPlaying(page);
  await playerOf(page).getByRole('button', { name: 'Next article' }).click();

  await expect(page).toHaveURL(new RegExp(`/articles/${second.id}$`));
  await expect(page.getByRole('heading', { name: second.title, level: 1 })).toBeVisible();
  await expectPlaying(page);
});

test('an article that no longer exists sends the member back to the list', async ({
  page: signInPage,
}, testInfo) => {
  const page = await memberOnArticles(signInPage, 'late-reader', testInfo);

  await page.goto('/articles/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', { waitUntil: 'commit' });

  await expect(page.getByText('This article is no longer available.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Articles', level: 1 })).toBeVisible();
});
