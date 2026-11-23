import { expect as baseExpect, test, type Page } from '@playwright/test';
import { withDatabase } from '../support/members.ts';
import {
  DEMO_WORDS,
  RESILIENT,
  type ProgressSeed,
  type ReviewCardSeed,
} from '../support/review-cards.ts';
import {
  captureScreen,
  demoAccount,
  dropRequests,
  expectShell,
  failRequests,
  settleScreen,
  UNAVAILABLE,
  withDemoWords,
  type DemoAccount,
} from '../support/screens.ts';

// Spell and Translate reviews in their confirmed states (.docs/design/screens, 43–50, 63, 71 and
// 72), with the demo account's nine saved words: `resilient` is the first due word of both modes,
// at round 2, so its question is Round 3 and a right answer waits 4 days.

test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

let account: DemoAccount;
let page: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  account = await demoAccount(browser, testInfo, 'review');
  page = account.page;
});

test.afterEach(async () => {
  await settleScreen(page);
});

test.afterAll(async () => {
  await account?.close();
});

/** The screen that shows; the Vocabulary screen may stay in the page, hidden. */
const shown = () => page.getByRole('main');
const button = (name: string) => shown().getByRole('button', { name, exact: true });
const answerBox = () => shown().getByRole('textbox', { name: 'Your answer' });
const option = (meaning: string) =>
  shown()
    .getByRole('group', { name: 'Options' })
    .getByRole('button', { name: new RegExp(`^${meaning}`) });

/** Opens the review of `mode` with the demo vocabulary (or `seeds`). */
async function openReview(
  mode: 'spell' | 'translate',
  seeds: readonly ReviewCardSeed[] = DEMO_WORDS,
  counts = { due: 5, new: 4 },
) {
  await withDemoWords(page, account.email, seeds);
  await account.open(`/review/${mode}`);
  const title = mode === 'spell' ? 'Spell' : 'Translate';
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expectShell(page, counts);
}

/** The question about `resilient`. */
async function openQuestion(mode: 'spell' | 'translate') {
  await openReview(mode);
  await expect(shown().getByText('Round 3')).toBeVisible();
}

async function submitAndSee(result: string) {
  await button('Submit').click();
  await expect(shown().getByText(result, { exact: true })).toBeVisible();
}

/**
 * The design's state of an empty Spell review: every Spell word that was new or due waits 3
 * hours plus an hour for each place in the saving order, at round 1 or more, so the nearest
 * waits 4 hours.
 */
function nothingDueInSpell(): ReviewCardSeed[] {
  return DEMO_WORDS.map((word, index) => {
    const spell: ProgressSeed = word.progress?.spell ?? { round: 0, dueInMinutes: null };
    const isNew = spell.round === 0 && spell.dueInMinutes === null;
    const isDue = spell.dueInMinutes !== null && spell.dueInMinutes <= 0;
    if (!isNew && !isDue) {
      return word;
    }
    const waiting = { round: Math.max(1, spell.round), dueInMinutes: 180 + (index + 1) * 60 };
    return { ...word, progress: { ...word.progress, spell: waiting } };
  });
}

test('43 and 44 a Spell question, answered right', async () => {
  await openQuestion('spell');
  await expect(shown().getByText(RESILIENT.meaningZh, { exact: true })).toBeVisible();
  await captureScreen(page, '43-review-spell');

  await answerBox().fill('resilient');
  await submitAndSee('Correct · Next review in 4 days');
  await expectShell(page, { due: 4, new: 4 });
  await captureScreen(page, '44-review-spell-correct');
});

test('45 a Spell question answered wrong', async () => {
  await openQuestion('spell');
  await answerBox().fill('resiliant');
  await submitAndSee('resilient · Try again in 10 mins');
  await expectShell(page, { due: 4, new: 4 });
  await captureScreen(page, '45-review-spell-wrong');
});

test('46 and 47 a Translate question, answered right', async () => {
  await openQuestion('translate');
  await expect(option(RESILIENT.meaningZh)).toBeVisible();
  await captureScreen(page, '46-review-translate');

  await option(RESILIENT.meaningZh).click();
  await submitAndSee('Correct · Next review in 4 days');
  await expectShell(page, { due: 4, new: 4 });
  await captureScreen(page, '47-review-translate-answered');
});

test('63 a Translate question answered wrong', async () => {
  await openQuestion('translate');
  await option(RESILIENT.wrongMeanings[0]).click();
  await submitAndSee(`${RESILIENT.meaningZh} · Try again in 10 mins`);
  await expectShell(page, { due: 4, new: 4 });
  await captureScreen(page, '63-review-translate-wrong');
});

test('48 nothing due, the next review in 4 hours', async () => {
  await openReview('spell', nothingDueInSpell(), { due: 2, new: 2 });
  await expect(shown().getByText('No reviews due.')).toBeVisible();
  await expect(shown().getByText('Next review in 4 hours.')).toBeVisible();
  await captureScreen(page, '48-review-empty');
});

test('49 an answer sent offline', async () => {
  await openQuestion('spell');
  await answerBox().fill('resilient');
  await dropRequests(page, '**/api/review/submit');
  await submitAndSee('Not saved. Reconnect to check the result.');
  await expect(button('Retry')).toBeVisible();
  await captureScreen(page, '49-review-offline');
});

test('50 the word changed on another device', async () => {
  await openQuestion('spell');
  await answerBox().fill('resilient');
  // Another device answers the question first.
  await withDatabase(async (sql) => {
    await sql`
      UPDATE review_progress SET round = 3, due_at = now() + interval '4 days'
      WHERE mode = 'spell' AND card_id IN (
        SELECT cards.id FROM vocabulary_cards cards JOIN members ON members.id = cards.owner_id
        WHERE members.email = ${account.email} AND cards.lemma = ${RESILIENT.lemma})`;
  });
  await submitAndSee('This word changed on another device.');
  await expectShell(page, { due: 4, new: 4 });
  await captureScreen(page, '50-review-changed');
});

test('71 the next question failing to load', async () => {
  await failRequests(page, '**/api/review/next**');
  await openReview('spell');
  await expect(shown().getByText("Couldn't load the next review.")).toBeVisible();
  await captureScreen(page, '71-review-load-failed');
});

test('72 the server failing to save the answer', async () => {
  await openQuestion('spell');
  await answerBox().fill('resilient');
  await failRequests(page, '**/api/review/submit', UNAVAILABLE);
  await button('Submit').click();
  await expect(page.getByText("Couldn't save your answer.")).toBeVisible();
  await expect(answerBox()).toBeEditable();
  await captureScreen(page, '72-review-submit-failed');
});
