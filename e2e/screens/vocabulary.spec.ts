import { expect as baseExpect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_WORDS, MORE_DEMO_WORDS, type ReviewCardSeed } from '../support/review-cards.ts';
import {
  captureScreen,
  demoAccount,
  expectShell,
  failRequests,
  holdNotices,
  settleScreen,
  UNAVAILABLE,
  withDemoWords,
  type DemoAccount,
} from '../support/screens.ts';

// The Vocabulary screen and the card details in their confirmed states (.docs/design/screens,
// 30–42, 60, 65–68 and 70), with the demo account's nine saved words. Due times are written just
// ahead of the database's clock and the page's clock shows that moment, so every card reads as
// the design's.

test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

let account: DemoAccount;
let page: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  account = await demoAccount(browser, testInfo, 'vocabulary');
  page = account.page;
});

test.afterEach(async () => {
  await settleScreen(page);
});

test.afterAll(async () => {
  await account?.close();
});

const list = (url: URL) => url.pathname === '/api/vocabulary';
const nextBatch = (url: URL) => list(url) && url.searchParams.has('cursor');
const card = (url: URL) => /^\/api\/vocabulary\/[0-9a-f-]{36}$/.test(url.pathname);

/** The Vocabulary screen as a member opens it, with the top bar complete. */
async function showVocabulary(
  seeds: readonly ReviewCardSeed[] = DEMO_WORDS,
  counts = { due: 5, new: 4 },
) {
  await withDemoWords(page, account.email, seeds);
  await account.open('/vocabulary');
  await expect(page.getByRole('heading', { name: 'Vocabulary', level: 1 })).toBeVisible();
  await expectShell(page, counts);
}

/** The demo account's nine words, with the mode buttons' counts. */
async function showWords() {
  await showVocabulary();
  await expect(page.getByText('9 words', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spell, 3 due, 2 new' })).toBeVisible();
}

const tab = (name: string) =>
  page.getByRole('group', { name: 'Word state' }).getByRole('button', { name, exact: true });

const wordCard = (lemma: string) =>
  page.locator('article').filter({ has: page.getByRole('button', { name: lemma, exact: true }) });

const touch = { pointerId: 11, pointerType: 'touch', isPrimary: true, button: 0 };

/** Where a touch on the middle of `target` lands. */
async function middleOf(target: Locator) {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error('The card is not on screen.');
  }
  return { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
}

/** A touch that starts in the middle of `target` and moves left by each of `steps`, in pixels. */
async function swipeLeft(target: Locator, steps: number[], release: boolean) {
  const start = await middleOf(target);
  await target.dispatchEvent('pointerdown', { ...touch, ...start });
  const at = (step: number) => ({
    ...touch,
    clientX: start.clientX - step,
    clientY: start.clientY,
  });
  for (const step of steps) {
    await target.dispatchEvent('pointermove', at(step));
  }
  if (release) {
    await target.dispatchEvent('pointerup', at(steps.at(-1) ?? 0));
  }
}

test('30 every word, A to Z, with the review modes', async () => {
  await showWords();
  await captureScreen(page, '30-vocabulary');
});

test('31, 32 and 33 the New, Ongoing and Archived tabs', async () => {
  await showWords();
  await tab('New').click();
  await expect(page.getByText('2 words', { exact: true })).toBeVisible();
  await captureScreen(page, '31-vocabulary-new');

  await tab('Ongoing').click();
  await expect(page.getByText('7 words', { exact: true })).toBeVisible();
  await captureScreen(page, '32-vocabulary-ongoing');

  await tab('Archived').click();
  await expect(page.getByText('No words match.')).toBeVisible();
  await captureScreen(page, '33-vocabulary-archived');
});

test('34 searching by part of speech', async () => {
  await showWords();
  await page.getByRole('textbox', { name: 'Search words, examples, 中文' }).fill('adjective');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('3 words', { exact: true })).toBeVisible();
  await captureScreen(page, '34-vocabulary-search');
});

test('35 a card swiped halfway, the finger still down', async () => {
  await showWords();
  await swipeLeft(wordCard('allocate'), [12, 24, 40], false);
  await expect(page.getByRole('button', { name: 'Delete allocate' })).toBeVisible();
  await captureScreen(page, '35-vocabulary-swipe-half');
});

test('36 and 37 a card swiped open, and deleting it', async () => {
  await showWords();
  await swipeLeft(wordCard('allocate'), [12, 40, 80], true);
  await expect(page.getByRole('button', { name: 'Delete allocate' })).toBeVisible();
  await captureScreen(page, '36-vocabulary-swipe-open');

  await page.getByRole('button', { name: 'Delete allocate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete word?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await captureScreen(page, '37-vocabulary-delete-one');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('38 a long press choosing a card', async () => {
  await showWords();
  await holdNotices(page);
  const consistent = wordCard('consistent');
  const at = await middleOf(consistent);
  await consistent.dispatchEvent('pointerdown', { ...touch, ...at });
  await expect(page.getByRole('region', { name: 'Selected words' })).toBeVisible();
  await consistent.dispatchEvent('pointerup', { ...touch, ...at });
  await expect(page.getByText('1 word selected.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select consistent' })).toBeChecked();
  await captureScreen(page, '38-vocabulary-long-press');
});

test('39, 40 and 60 three words chosen, deleting them, and the deletion failing', async () => {
  await showWords();
  await page.getByRole('button', { name: 'Select words' }).click();
  for (const lemma of ['allocate', 'gradually', 'sustain']) {
    await page.getByRole('checkbox', { name: `Select ${lemma}` }).check();
  }
  await expect(page.getByText('3 selected')).toBeVisible();
  await captureScreen(page, '39-vocabulary-multi-select');

  await page.getByRole('button', { name: 'Delete 3 selected words' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete 3 words?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await captureScreen(page, '40-vocabulary-batch-delete');

  await failRequests(page, '**/api/vocabulary/bulk-delete', UNAVAILABLE);
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText("Couldn't delete. Try again.")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('3 selected')).toBeVisible();
  await captureScreen(page, '60-vocabulary-delete-failed');
});

test('41 no words yet', async () => {
  await showVocabulary([], { due: 0, new: 0 });
  await expect(
    page.getByText('No words yet. Select a word while reading to look it up.'),
  ).toBeVisible();
  await captureScreen(page, '41-vocabulary-empty');
});

test('42 the details of a word', async () => {
  await showWords();
  await page.getByRole('button', { name: 'resilient', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'resilient', level: 1 })).toBeVisible();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await captureScreen(page, '42-card-detail');
});

test('70 the details of a word failing to load', async () => {
  await showWords();
  await failRequests(page, card);
  await page.getByRole('button', { name: 'resilient', exact: true }).click();
  await expect(page.getByText("Couldn't load this word.")).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Close word and return to Vocabulary' }),
  ).toBeVisible();
  await captureScreen(page, '70-card-detail-load-failed');
});

test('65 the Spell round filter', async () => {
  await showWords();
  await page.getByRole('button', { name: 'Filter Spell round' }).click();
  await page.getByRole('checkbox', { name: 'Round 3' }).check();
  await captureScreen(page, '65-vocabulary-round-filter');
});

test('66 the sort panel', async () => {
  await showWords();
  await page.getByRole('button', { name: 'Sort by Word, ascending' }).click();
  await expect(page.getByRole('dialog', { name: 'Sort' })).toBeVisible();
  await captureScreen(page, '66-vocabulary-sort');
});

test('67 the words failing to load', async () => {
  await failRequests(page, list);
  await showVocabulary();
  await expect(page.getByText("Couldn't load words.")).toBeVisible();
  await captureScreen(page, '67-vocabulary-load-failed');
});

test('68 the next batch failing to load', async () => {
  await showVocabulary([...DEMO_WORDS, ...MORE_DEMO_WORDS]);
  await expect(page.getByText('25 words', { exact: true })).toBeVisible();
  await failRequests(page, nextBatch);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText("Couldn't load more words.")).toBeVisible();
  await captureScreen(page, '68-vocabulary-load-more-failed');
});
