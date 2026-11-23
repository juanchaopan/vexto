import { expect as baseExpect, test, type Page } from '@playwright/test';
import { DEMO_ARTICLES } from '../support/articles.ts';
import {
  captureScreen,
  demoAccount,
  dropRequests,
  expectShell,
  failRequests,
  holdNotices,
  holdRequests,
  settleScreen,
  UNAVAILABLE,
  withDemoCounts,
  type DemoAccount,
} from '../support/screens.ts';

// Looking words up and saving them in their confirmed states (.docs/design/screens, 20–29 and
// 56–59), in the demo article about lunar dust. The stand-in for OpenAI gives the prototype's
// explanations; there is no speech service in this run, so word audio is not available.

test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

let account: DemoAccount;
let page: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  account = await demoAccount(browser, testInfo, 'lookup');
  page = account.page;
});

test.afterEach(async () => {
  await settleScreen(page);
});

test.afterAll(async () => {
  await account?.close();
});

const lunar = DEMO_ARTICLES[0];
const lookups = (url: URL) => url.pathname === '/api/lookups';
const saving = (url: URL) => url.pathname === '/api/vocabulary';

/** The lunar dust article, with the demo vocabulary and no explanation open. */
async function openArticle() {
  await withDemoCounts(account.email);
  await account.open(`/articles/${lunar.id}`);
  await expect(page.getByRole('heading', { name: lunar.title, level: 1 })).toBeVisible();
  await expectShell(page);
}

const explanation = (name: string) => page.getByRole('region', { name: `Explanation of ${name}` });

/** Taps a word of the article. */
async function tapWord(word: string) {
  await page.locator('[data-sentence] span', { hasText: new RegExp(`^${word}$`) }).click();
}

async function lookUp(word: string, meaning: string) {
  await tapWord(word);
  await expect(explanation(word).getByText(meaning)).toBeVisible();
}

test('20, 21 and 22 explaining, the explanation and its second example', async () => {
  await openArticle();
  const release = await holdRequests(page, lookups);
  await tapWord('resilient');
  await expect(page.getByText('Explaining…')).toBeVisible();
  await captureScreen(page, '20-lookup-loading');

  await release();
  const resilient = explanation('resilient');
  await expect(resilient.getByText('有韧性的；经得起损耗的')).toBeVisible();
  await expect(resilient.getByText('1 / 2')).toBeVisible();
  await captureScreen(page, '21-lookup');

  await resilient.getByRole('button', { name: 'Next example' }).click();
  await expect(resilient.getByText('2 / 2')).toBeVisible();
  // The design's state shows the second example without the passing notice.
  await expect(page.getByText('Example 2 of 2')).toBeHidden();
  await captureScreen(page, '22-lookup-example-2');
});

test('23 and 24 the word audio being made, then not available', async () => {
  await openArticle();
  await lookUp('resilient', '有韧性的；经得起损耗的');
  const resilient = explanation('resilient');
  const release = await holdRequests(page, '**/api/media/playback');
  await resilient.getByRole('button', { name: 'Play word' }).click();
  await expect(resilient.getByRole('button', { name: 'Generating word audio' })).toBeVisible();
  await captureScreen(page, '23-lookup-word-audio-generating');

  await release();
  await expect(resilient.getByText("Audio isn't available right now.")).toBeVisible();
  await captureScreen(page, '24-lookup-audio-unavailable');
});

test('25 the explanation failing', async () => {
  await openArticle();
  await failRequests(page, lookups, UNAVAILABLE);
  await tapWord('resilient');
  await expect(page.getByText("Couldn't explain this.")).toBeVisible();
  await captureScreen(page, '25-lookup-failed');
});

test('56 looking up offline', async () => {
  await openArticle();
  await dropRequests(page, lookups);
  await tapWord('resilient');
  await expect(page.getByText("You're offline. Connect to look up words.")).toBeVisible();
  await captureScreen(page, '56-lookup-offline');
});

test('26 a selection of more than eight words', async () => {
  await openArticle();
  await holdNotices(page);
  // Ten words of the eighth sentence, selected as a long press and drag leaves them.
  await page.evaluate(() => {
    const words = document.querySelectorAll('[data-sentence="7"] [data-word-start]');
    const range = document.createRange();
    range.setStartBefore(words[0]);
    range.setEndAfter(words[9]);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await expect(page.getByText('Select up to 8 words.')).toBeVisible();
  await expect(page.getByRole('region', { name: /^Explanation of/ })).toHaveCount(0);
  await captureScreen(page, '26-lookup-too-long');
});

test('27 an explanation of a word in an example, above the first', async () => {
  await openArticle();
  await lookUp('resilient', '有韧性的；经得起损耗的');
  await explanation('resilient').getByText('coating', { exact: true }).click();
  await expect(explanation('coating').getByText('涂层；覆盖层')).toBeVisible();
  await captureScreen(page, '27-lookup-nested');
});

test('57 a new example failing', async () => {
  await openArticle();
  await lookUp('resilient', '有韧性的；经得起损耗的');
  await failRequests(page, '**/api/lookups/*/examples/*/refresh', UNAVAILABLE);
  await explanation('resilient').getByRole('button', { name: 'Refresh this example' }).click();
  await expect(page.getByText("Couldn't get a new example.")).toBeVisible();
  await captureScreen(page, '57-lookup-refresh-failed');
});

test('58 and 28 saving a word failing, then saved', async () => {
  await openArticle();
  await lookUp('adapt', '使适应；调整');
  const adapt = explanation('adapt');
  await failRequests(page, saving, UNAVAILABLE);
  await adapt.getByRole('button', { name: 'Add word' }).click();
  await expect(page.getByText("Couldn't save the word.")).toBeVisible();
  await expect(adapt.getByRole('button', { name: 'Add word' })).toBeEnabled();
  await captureScreen(page, '58-save-failed');

  await settleScreen(page);
  await holdNotices(page);
  await adapt.getByRole('button', { name: 'Add word' }).click();
  await expect(page.getByText('Saved to Vocabulary.')).toBeVisible();
  await expect(adapt.getByRole('button', { name: 'Saved to Vocabulary' })).toBeVisible();
  await expectShell(page, { due: 5, new: 6 });
  await captureScreen(page, '28-save-saved');
});

test('29 and 59 replacing a saved word, and the replacement failing', async () => {
  await openArticle();
  await lookUp('resilient', '有韧性的；经得起损耗的');
  await explanation('resilient').getByRole('button', { name: 'Add word' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace saved word?' });
  await expect(dialog.getByText('resilient · adjective')).toBeVisible();
  // Behind the modal dialog the explanation is inert, so its button is found by its label.
  await expect(page.locator('[aria-label="Add word"]')).toBeEnabled();
  await captureScreen(page, '29-save-replace');

  await failRequests(page, '**/api/vocabulary/*/replace', UNAVAILABLE);
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText("Couldn't replace the word.")).toBeVisible();
  await expect(dialog).toBeVisible();
  await captureScreen(page, '59-replace-failed');
});
