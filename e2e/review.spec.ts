import { clerkSetup } from '@clerk/testing/playwright';
import { expect as baseExpect, test, type Page, type TestInfo } from '@playwright/test';
import { ensureClerkUser, signInAndOpen, testEmail } from './support/clerk.ts';
import { inviteMember } from './support/members.ts';
import { RESILIENT, seedReviewCard, STICKY } from './support/review-cards.ts';

// Reviewing the vocabulary (.docs/design/screens.md, 复习, Spell and Translate) with two cards
// written straight to the database: `resilient` due in Spell and Translate at round 2, and
// `sticky` a new word. From Vocabulary into each review, a right and a wrong answer, the counts
// on the top bar and the mode buttons moving with them, the empty review, and back to
// Vocabulary with the focus on the mode's button. Due times count from the database's time.
// The Vocabulary screen stays in the page while hidden, so the review's texts are looked for in
// the screen that shows.

// Signing in through Clerk takes a good part of the default 30 seconds, and with both browsers
// running side by side a request to the built application can take several seconds; the tests
// of this file run one after another in one worker per browser.
test.describe.configure({ mode: 'default', timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await clerkSetup();
});

const due = { round: 2, dueInMinutes: -60 };

/** A signed-in member who accepted the terms, with the two cards, on the Vocabulary screen. */
async function memberWithCards(signInPage: Page, role: string, testInfo: TestInfo) {
  const email = testEmail(role, testInfo);
  await ensureClerkUser(email);
  await inviteMember(email);
  await seedReviewCard(email, { ...RESILIENT, progress: { spell: due, translate: due } });
  await seedReviewCard(email, { ...STICKY, savedMinutesAgo: 30 });
  await signInPage.goto('/sign-in');
  const page = await signInAndOpen(signInPage, email, '/license');
  const accepted = await page.request.post('/api/terms/acceptance', { data: { version: 1 } });
  expect(accepted.status()).toBe(200);
  await page.goto('/vocabulary');
  await expect(page.getByRole('heading', { name: 'Vocabulary', level: 1 })).toBeVisible();
  return page;
}

const topBar = (page: Page, due: number, fresh: number) =>
  page.getByRole('link', { name: `Vocabulary, ${due} due reviews, ${fresh} new reviews` });

/** The screen that shows. */
const shown = (page: Page) => page.getByRole('main');

const button = (page: Page, name: string) => shown(page).getByRole('button', { name, exact: true });

const option = (page: Page, meaning: string) =>
  shown(page)
    .getByRole('group', { name: 'Options' })
    .getByRole('button', { name: new RegExp(`^${meaning}`) });

async function submitAndSee(page: Page, result: string) {
  await button(page, 'Submit').click();
  await expect(shown(page).getByText(result, { exact: true })).toBeVisible();
}

async function nextIsEmpty(page: Page) {
  await button(page, 'Next').click();
  await expect(shown(page).getByText('No reviews due.')).toBeVisible();
  await expect(shown(page).getByText('Next review in 10 mins.')).toBeVisible();
}

async function close(page: Page) {
  await button(page, 'Close review and return to Vocabulary').click();
  await expect(page.getByRole('heading', { name: 'Vocabulary', level: 1 })).toBeVisible();
}

test('a member spells a word right and one wrong, and goes back to Vocabulary', async ({
  page: signInPage,
}, testInfo) => {
  const page = await memberWithCards(signInPage, 'review-spell', testInfo);
  await expect(topBar(page, 2, 2)).toBeVisible();

  await page.getByRole('button', { name: 'Spell, 1 due, 1 new' }).click();
  await expect(page.getByRole('heading', { name: 'Spell', level: 1 })).toBeVisible();
  await expect(shown(page).getByText(RESILIENT.meaningZh, { exact: true })).toBeVisible();
  await expect(shown(page).getByText('Round 3')).toBeVisible();
  await expect(shown(page).getByRole('img', { name: 'Hidden word' })).toHaveCount(1);
  const answer = shown(page).getByRole('textbox', { name: 'Your answer' });
  await answer.fill('Resilient');
  await submitAndSee(page, 'Correct · Next review in 4 days');
  await expect(topBar(page, 1, 2)).toBeVisible();

  await button(page, 'Next').click();
  await expect(shown(page).getByText(STICKY.meaningZh, { exact: true })).toBeVisible();
  await expect(shown(page).getByText('Round 1')).toBeVisible();
  await answer.fill('stiky');
  await submitAndSee(page, 'sticky · Try again in 10 mins');
  await expect(topBar(page, 1, 1)).toBeVisible();
  await nextIsEmpty(page);

  await close(page);
  await expect(page.getByRole('button', { name: 'Spell, 0 due, 0 new' })).toBeFocused();
  await expect(page.getByRole('group', { name: 'Spell, Round 4, 4 days' })).toBeVisible();
});

test('a member chooses a wrong meaning and a right one, and goes back to Vocabulary', async ({
  page: signInPage,
}, testInfo) => {
  const page = await memberWithCards(signInPage, 'review-translate', testInfo);

  await page.getByRole('button', { name: 'Translate, 1 due, 1 new' }).click();
  await expect(page.getByRole('heading', { name: 'Translate', level: 1 })).toBeVisible();
  await expect(shown(page).getByText('Round 3')).toBeVisible();
  await option(page, RESILIENT.wrongMeanings[0]).click();
  await submitAndSee(page, `${RESILIENT.meaningZh} · Try again in 10 mins`);
  await expect(option(page, RESILIENT.wrongMeanings[0])).toBeDisabled();
  await expect(topBar(page, 1, 2)).toBeVisible();

  await button(page, 'Next').click();
  await expect(shown(page).getByText('Round 1')).toBeVisible();
  await option(page, STICKY.meaningZh).click();
  await submitAndSee(page, 'Correct · Next review in 1 day');
  await expect(topBar(page, 1, 1)).toBeVisible();
  await nextIsEmpty(page);

  await close(page);
  await expect(page.getByRole('button', { name: 'Translate, 0 due, 0 new' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Spell, 1 due, 1 new' })).toBeVisible();
});
