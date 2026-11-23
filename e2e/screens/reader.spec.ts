import { expect as baseExpect, test, type Page } from '@playwright/test';
import { DEMO_ARTICLES, sentenceStartMs } from '../support/articles.ts';
import {
  captureScreen,
  demoAccount,
  expectShell,
  failRequests,
  holdAudioAt,
  refuseAutoplay,
  settleScreen,
  UNAVAILABLE,
  withDemoCounts,
  type DemoAccount,
} from '../support/screens.ts';

// The reader and the player in their confirmed states (.docs/design/screens, 13–19, 54, 64 and
// 69), on the demo articles. The article audio is silent; a playing state is held at a moment of
// the audio, so the highlight and the progress stay where the design shows them.

test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

let account: DemoAccount;
let page: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  account = await demoAccount(browser, testInfo, 'reader');
  page = account.page;
});

test.afterEach(async () => {
  await settleScreen(page);
});

test.afterAll(async () => {
  await account?.close();
});

const lunar = DEMO_ARTICLES[0];
const quieter = DEMO_ARTICLES[1];
const tradeCards = DEMO_ARTICLES[4];

const player = () => page.getByRole('region', { name: 'Article player' });
const topButton = (name: string) => page.getByRole('button', { name, exact: true }).first();
const activeSentence = () => page.locator('[data-sentence-row][data-active]');

/**
 * Opens a demo article with the player as a new session leaves it: the speed the device keeps
 * (src/features/reading/ui/player-store.ts) back at 1×, and no queue.
 */
async function openArticle(article = lunar) {
  await withDemoCounts(account.email);
  await account.open('/license');
  await page.evaluate(() => {
    window.localStorage.removeItem('vexto.playback-speed');
    window.sessionStorage.removeItem('vexto.playback-queue');
  });
  await account.open(`/articles/${article.id}`);
  await expect(page.getByRole('heading', { name: article.title, level: 1 })).toBeVisible();
  await expectShell(page);
}

/** Holds the playing article inside the sentence at `index` (counting from 0). */
async function holdInSentence(index: number, article = lunar) {
  await holdAudioAt(page, sentenceStartMs(article, index) + 50);
  await expect(activeSentence()).toContainText(article.paragraphs.flat()[index]);
}

/** Starts a continuous play of the whole list with Play all. */
async function playAll() {
  await page.getByRole('button', { name: 'Articles', exact: true }).first().click();
  await page.getByRole('button', { name: 'Play all articles' }).click();
  await expect(page).toHaveURL(new RegExp(`/articles/${lunar.id}$`));
  await expect(topButton('Pause article')).toBeVisible();
}

test('13 an article before playing', async () => {
  await openArticle();
  await expect(player().getByText(`${lunar.title} · 1/10`)).toBeVisible();
  await captureScreen(page, '13-reader');
});

test('14 playing, the third sentence highlighted', async () => {
  await openArticle();
  await topButton('Play article').click();
  await holdInSentence(2);
  await expect(topButton('Pause article')).toBeVisible();
  await expect(player().getByText(`${lunar.title} · 3/10`)).toBeVisible();
  await captureScreen(page, '14-reader-playing');
});

test('15 one sentence played and still selected', async () => {
  await openArticle();
  await page.getByRole('button', { name: 'Play sentence 5', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Stop sentence 5 and clear the selection' }),
  ).toBeVisible();
  // The sentence plays to its end, where the player stops by itself.
  await holdAudioAt(page, sentenceStartMs(lunar, 5));
  await expect(topButton('Play article from sentence 5')).toBeVisible();
  await captureScreen(page, '15-reader-sentence-selected');
});

test('16 the speed panel at 1.25×', async () => {
  await openArticle();
  await topButton('Play article').click();
  await holdInSentence(2);
  await topButton('Pause article').click();
  await expect(topButton('Resume article')).toBeVisible();
  await player().getByRole('button', { name: 'Playback speed, 1×' }).click();
  await page.getByRole('radio', { name: '1.25×' }).click();
  await player().getByRole('button', { name: 'Playback speed, 1.25×' }).click();
  await expect(page.getByRole('radio', { name: '1.25×' })).toBeChecked();
  await captureScreen(page, '16-reader-speed');
});

test('17 a continuous play with the next-article button', async () => {
  await openArticle();
  await playAll();
  await holdInSentence(5);
  await expect(player().getByRole('button', { name: 'Next article' })).toBeVisible();
  await captureScreen(page, '17-reader-continuous');
});

test('19 the browser refusing to go on by itself: Tap to continue', async () => {
  await openArticle();
  await playAll();
  await refuseAutoplay(page, true);
  await player().getByRole('button', { name: 'Next article' }).click();
  await expect(page.getByRole('heading', { name: quieter.title, level: 1 })).toBeVisible();
  await expect(player().getByRole('button', { name: 'Tap to continue' })).toBeVisible();
  await captureScreen(page, '19-reader-tap-to-continue');
  await refuseAutoplay(page, false);
});

test('18 the attribution at the end of an article', async () => {
  await openArticle(tradeCards);
  await expect(page.getByRole('link', { name: 'Original' })).toBeVisible();
  await captureScreen(page, '18-reader-attribution');
});

test('54 the article failing to play', async () => {
  await openArticle();
  await failRequests(page, '**/api/media/playback', UNAVAILABLE);
  await topButton('Play article').click();
  await expect(page.getByText("Couldn't play this article.")).toBeVisible();
  await expect(topButton('Play article')).toBeVisible();
  await expect(activeSentence()).toHaveCount(0);
  await captureScreen(page, '54-reader-play-failed');
});

test('64 the Select words helper', async () => {
  await openArticle();
  await topButton('Select words for lookup').click();
  const tool = page.getByRole('dialog', { name: 'Select words' });
  await tool.getByRole('combobox', { name: 'Sentence' }).selectOption('2');
  await tool.getByRole('combobox', { name: 'From' }).selectOption('5');
  await tool.getByRole('combobox', { name: 'To' }).selectOption('5');
  await captureScreen(page, '64-reader-select-words-helper');
});

test('69 the article failing to load', async () => {
  await withDemoCounts(account.email);
  await failRequests(page, `**/api/articles/${lunar.id}`);
  await account.open(`/articles/${lunar.id}`);
  await expect(page.getByText("Couldn't load this article.")).toBeVisible();
  await expectShell(page);
  await captureScreen(page, '69-reader-load-failed');
});
