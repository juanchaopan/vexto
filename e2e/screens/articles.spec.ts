import { expect as baseExpect, test, type Page } from '@playwright/test';
import {
  captureScreen,
  demoAccount,
  expectShell,
  failRequests,
  holdNotices,
  holdRequests,
  settleScreen,
  withDemoDay,
  type DemoAccount,
} from '../support/screens.ts';

// The Articles screen in its confirmed states (.docs/design/screens, 05–12, 52, 53 and 55), with
// the 23 demo articles, the demo account's visits and its vocabulary for the top bar's counts,
// on the demo's day.

test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

let account: DemoAccount;
let page: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  account = await demoAccount(browser, testInfo, 'articles');
  page = account.page;
});

test.afterEach(async () => {
  await settleScreen(page);
});

test.afterAll(async () => {
  await account?.close();
});

const firstBatch = (url: URL) =>
  url.pathname === '/api/articles' && !url.searchParams.has('cursor');
const nextBatch = (url: URL) => url.pathname === '/api/articles' && url.searchParams.has('cursor');

/** The Articles screen as a member opens it, with the top bar complete. */
async function showArticles() {
  await withDemoDay(page, account.email);
  await account.open('/');
  await expect(page.getByRole('heading', { name: 'Articles', level: 1 })).toBeVisible();
  await expectShell(page);
}

/** The first batch of the list, with Load more under it. */
async function showList() {
  await showArticles();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
}

async function search(text: string) {
  await page.getByRole('textbox', { name: 'Search article text' }).fill(text);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

test('05 the newest articles first, with Load more', async () => {
  await showList();
  await expect(page.locator('article')).toHaveCount(20);
  await captureScreen(page, '05-articles');
});

test('06 and 07 the Source filter, then the Category filter', async () => {
  await showList();
  await page.getByRole('button', { name: 'Filter Source' }).click();
  await page.getByRole('checkbox', { name: 'NASA Technology' }).check();
  await page.getByRole('checkbox', { name: 'NIST News' }).check();
  await captureScreen(page, '06-articles-filter-source');

  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(
    page.getByRole('button', { name: 'Filter Source, NASA Technology, NIST News' }),
  ).toBeVisible();
  await expect(page.getByText('10 articles')).toBeVisible();
  await page.getByRole('button', { name: 'Filter Category' }).click();
  await page.getByRole('checkbox', { name: 'Technology', exact: true }).check();
  await captureScreen(page, '07-articles-filter-category');
});

test('08 the sort panel', async () => {
  await showList();
  await page.getByRole('button', { name: /^Sort by Collected/ }).click();
  await expect(page.getByRole('dialog', { name: 'Sort' })).toBeVisible();
  await captureScreen(page, '08-articles-sort');
});

test('09 search results, all loaded', async () => {
  await showList();
  await search('satellite');
  await expect(page.getByText('All loaded')).toBeVisible();
  await captureScreen(page, '09-articles-search');
});

test('10 a search without results', async () => {
  await showList();
  await search('volcano');
  await expect(page.getByText('No articles match.')).toBeVisible();
  await captureScreen(page, '10-articles-search-empty');
});

test('11 the next batch loading', async () => {
  await showList();
  const release = await holdRequests(page, nextBatch);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  await captureScreen(page, '11-articles-loading-more');
  await release();
});

test('12 no articles yet', async () => {
  await page.route(firstBatch, (route) =>
    route.fulfill({ json: { data: [], meta: { nextCursor: null, totalCount: 0 } } }),
  );
  await showArticles();
  await expect(page.getByText('No articles yet.')).toBeVisible();
  await captureScreen(page, '12-articles-empty');
});

test('52 the first batch fails to load', async () => {
  await failRequests(page, firstBatch);
  await showArticles();
  await expect(page.getByText("Couldn't load articles.")).toBeVisible();
  await captureScreen(page, '52-articles-load-failed');
});

test('53 the next batch fails to load', async () => {
  await showList();
  await failRequests(page, nextBatch);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText("Couldn't load more articles.")).toBeVisible();
  await captureScreen(page, '53-articles-load-more-failed');
});

test('55 an article that is no longer available', async () => {
  await withDemoDay(page, account.email);
  await holdNotices(page);
  await account.open('/articles/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', { waitUntil: 'commit' });
  await expect(page.getByText('This article is no longer available.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
  await expectShell(page);
  await captureScreen(page, '55-reader-article-gone');
});
