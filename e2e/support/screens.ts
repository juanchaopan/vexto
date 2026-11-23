import { clerkSetup } from '@clerk/testing/playwright';
import {
  expect as baseExpect,
  type Browser,
  type BrowserContext,
  type Disposable,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { seedDemoArticles, seedDemoVisits } from './articles.ts';
import { ensureClerkUser, signInAndOpen, testEmail } from './clerk.ts';
import { inviteMember, setTermsAcceptance } from './members.ts';
import { DEMO_WORDS, seedVocabulary, type ReviewCardSeed } from './review-cards.ts';

// Screenshots of the confirmed screens (.docs/design/README.md, 截图): each state is reached with
// the demo account's data, at the design's phone size, and compared pixel by pixel with its
// baseline, which only the pinned Playwright container writes. Like the design's images, a
// capture shows the whole page: the window grows to the page's height first, so parts fixed to
// the bottom, such as the player and the explanations, are drawn at the bottom of the page.
//
// The page's clock is set only for screens that show times: the demo's day for the article and
// terms dates, and the moment the vocabulary's due times count from for the word screens. Other
// screens keep the real time.

// With every test file running side by side in both browsers, a page of the built application
// can take several seconds to answer, and a whole-page screenshot of a long list in WebKit takes
// seconds of its own.
const expect = baseExpect.configure({ timeout: 20_000 });
const SCREENSHOT_TIMEOUT = 30_000;

/**
 * How long a page may take to have the member's Clerk account. A loading page waits up to 7
 * seconds for the account from Clerk's development instance and then asks again without a time
 * limit, so a slow answer still arrives in this time.
 */
const ACCOUNT_TIMEOUT = 45_000;

/** The phone screen of the design, in CSS pixels. */
export const SCREEN_SIZE = { width: 390, height: 844 };

/** "Now" in the demo data: the collection and visit times of the articles read from it. */
export const DEMO_NOW = new Date('2026-11-22T10:00:00Z');

/** When the demo account accepted the current terms (62 reads `Accepted Nov 22.`). */
const DEMO_TERMS_ACCEPTED = new Date('2026-11-22T09:15:00Z');

/** The demo account's name; the avatar shows its initials. */
const DEMO_PERSON = { firstName: 'Alex', lastName: 'Chen' };
const DEMO_INITIALS = 'AC';

/** How long a plain notice stays (TOAST_DURATION_MS in src/lib/ui/toast.tsx). */
const NOTICE_MS = 3500;

type ScreenWindow = Window & {
  screenAudio?: HTMLMediaElement;
  refusePlay?: boolean;
  holdNotices?: boolean;
};

/**
 * Runs in every screen page before its own scripts, and keeps the states still long enough to
 * be captured: a list loads its next batch only when Load more is pressed, a plain notice stays
 * once the test asks for it, and the article audio is reachable from the test, which can hold it
 * at one moment or have the browser refuse to start it, as autoplay rules do.
 *
 * A notice is held by stretching the timer that removes it. The page clock that some screens set
 * (`page.clock`) puts its own `setTimeout` in place after this script has run, so `setTimeout`
 * is an accessor that wraps whatever timer function is put there, the browser's or the clock's.
 */
function steadyScreens(noticeMs: number) {
  const scope = window as ScreenWindow;
  Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true });
  const holding = (setTimer: typeof setTimeout) =>
    ((handler: TimerHandler, timeout?: number, ...rest: unknown[]) => {
      const held = scope.holdNotices === true && timeout === noticeMs;
      return setTimer(handler, held ? 2 ** 31 - 1 : timeout, ...rest);
    }) as typeof setTimeout;
  let current = holding(window.setTimeout.bind(window));
  Object.defineProperty(window, 'setTimeout', {
    configurable: true,
    get: () => current,
    set: (next: typeof setTimeout) => {
      current = holding(next);
    },
  });
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function playForScreens(this: HTMLMediaElement) {
    scope.screenAudio = this;
    if (scope.refusePlay) {
      return Promise.reject(new DOMException('Playback needs a tap.', 'NotAllowedError'));
    }
    return play.call(this);
  };
}

/** A browser context of the test's project at the design's screen size, light and still. */
async function screenContext(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  const { userAgent, isMobile, hasTouch, deviceScaleFactor, baseURL, locale, timezoneId } =
    testInfo.project.use;
  const context = await browser.newContext({
    userAgent,
    isMobile,
    hasTouch,
    deviceScaleFactor,
    baseURL,
    locale,
    timezoneId,
    viewport: SCREEN_SIZE,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(steadyScreens, NOTICE_MS);
  return context;
}

/**
 * Waits until the page is past the sign-in page with the member's whole Clerk account loaded:
 * the account with its email address, not only the session that Clerk can rebuild from the
 * session cookie while the account is still on its way. A page that went through the sign-in
 * page is brought back by Clerk once it finds the session.
 */
async function waitForAccount(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const clerk = window.Clerk;
        return (
          !window.location.pathname.startsWith('/sign-in') &&
          clerk?.loaded === true &&
          Boolean(clerk.user?.primaryEmailAddress)
        );
      },
      undefined,
      { timeout: ACCOUNT_TIMEOUT },
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      at: window.location.pathname,
      clerk: window.Clerk?.status ?? 'missing',
      account: Boolean(window.Clerk?.user?.primaryEmailAddress),
    }));
    throw new Error(
      `The page had no Clerk account in ${ACCOUNT_TIMEOUT / 1000} s: it is at ${state.at}, ` +
        `Clerk is ${state.clerk}, the account is ${state.account ? 'loaded' : 'missing'}.`,
      { cause: error },
    );
  }
}

type OpenOptions = { waitUntil?: 'load' | 'domcontentloaded' | 'commit' };

export type DemoAccount = {
  page: Page;
  email: string;
  /** Opens `path` and waits until the page has the member's Clerk account loaded. */
  open(path: string, options?: OpenOptions): Promise<void>;
  close(): Promise<void>;
};

/**
 * Signs in a member named like the demo account, with the demo articles and visits, who accepted
 * the terms when the demo account did. Each test file uses a member of its own (`role`), so
 * files that change the member's data run side by side.
 */
export async function demoAccount(
  browser: Browser,
  testInfo: TestInfo,
  role: string,
): Promise<DemoAccount> {
  await clerkSetup();
  await seedDemoArticles();
  const email = testEmail(`screens-${role}`, testInfo);
  await ensureClerkUser(email, DEMO_PERSON);
  await inviteMember(email);
  await seedDemoVisits(email);
  await acceptTermsLikeDemo(email);
  const context = await screenContext(browser, testInfo);
  const signInPage = await context.newPage();
  await signInPage.goto('/sign-in');
  const page = await signInAndOpen(signInPage, email, '/license');

  const open = async (path: string, options: OpenOptions = {}) => {
    await page.goto(path, options);
    await waitForAccount(page);
  };

  return { page, email, open, close: () => context.close() };
}

/** A page of a signed-out browser at the design's screen size. */
export async function signedOutPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await screenContext(browser, testInfo);
  return context.newPage();
}

/** Records the demo account's acceptance of the current terms for this member. */
export function acceptTermsLikeDemo(email: string): Promise<void> {
  return setTermsAcceptance(email, DEMO_TERMS_ACCEPTED);
}

/**
 * Stops the page's clock at `time`, with the page left blank: open a screen next. Playwright puts
 * its clock into a page that is already open in two steps, and in between the page reads a time
 * in January 1970. Clerk writing its cookies in that moment gives them an expiry in the past, so
 * the browser drops them and the next page has no session; a blank page writes nothing, and every
 * page opened afterwards starts with the clock in place. Later changes of the clock happen on the
 * blank page too, so a running Clerk never sees its time jump.
 */
async function setScreenClock(page: Page, time: Date): Promise<void> {
  await page.goto('about:blank');
  await page.clock.setFixedTime(time);
}

/**
 * Gives the member the demo vocabulary again, so the top bar shows the design's counts. Call it
 * right before opening a screen: the due times count from just ahead of the database's clock.
 */
export async function withDemoCounts(email: string): Promise<void> {
  await seedVocabulary(email, DEMO_WORDS);
}

/**
 * Gives the member the demo vocabulary (or `seeds`) and makes the page's clock show the moment
 * its due times count from, so every due time reads as the design's. The page is left blank.
 */
export async function withDemoWords(
  page: Page,
  email: string,
  seeds: readonly ReviewCardSeed[] = DEMO_WORDS,
): Promise<void> {
  const moment = await seedVocabulary(email, seeds);
  await setScreenClock(page, moment);
}

/**
 * Gives the member the demo vocabulary for the counts and makes the page's clock show the demo's
 * now, so the article and terms dates read as the design's. The page is left blank.
 */
export async function withDemoDay(page: Page, email: string): Promise<void> {
  await withDemoCounts(email);
  await setScreenClock(page, DEMO_NOW);
}

/**
 * Waits for the top bar to be complete: the review counts on the Vocabulary button (none shown
 * for zero) and the avatar's initials, which come once Clerk has loaded the account.
 */
export async function expectShell(page: Page, counts = { due: 5, new: 4 }): Promise<void> {
  await expect(
    page.getByRole('link', {
      name: `Vocabulary, ${counts.due} due reviews, ${counts.new} new reviews`,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu' })).toHaveText(DEMO_INITIALS);
}

const noticeHolds = new WeakMap<Page, Disposable>();

/**
 * Keeps plain notices on screen until another replaces them, from now on and in the pages this
 * page opens next, until `settleScreen` is called. It works with and without the page clock.
 */
export async function holdNotices(page: Page): Promise<void> {
  const hold = () => {
    (window as ScreenWindow).holdNotices = true;
  };
  noticeHolds.set(page, await page.addInitScript(hold));
  await page.evaluate(hold);
}

/** Ends what a screen test set up on the page: its own answers to requests and held notices. */
export async function settleScreen(page: Page): Promise<void> {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await noticeHolds.get(page)?.dispose();
  noticeHolds.delete(page);
}

/**
 * Captures the page as the design's image `name` (e.g. `05-articles`) and compares it with the
 * baseline. `mask` covers areas whose content is not the application's own.
 */
export async function captureScreen(
  page: Page,
  name: string,
  options: { mask?: Locator[] } = {},
): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({
    width: SCREEN_SIZE.width,
    height: Math.max(SCREEN_SIZE.height, height),
  });
  try {
    await expect(page).toHaveScreenshot(`${name}.png`, {
      mask: options.mask,
      timeout: SCREENSHOT_TIMEOUT,
    });
  } finally {
    await page.setViewportSize(SCREEN_SIZE);
  }
}

/** The requests a test answers itself: a URL pattern or a test of the URL. */
export type RequestMatch = string | ((url: URL) => boolean);

export type ApiFailure = { status: number; code: string; retryable: boolean };

/** An internal error of the server (500), with Retry offered. */
export const INTERNAL: ApiFailure = { status: 500, code: 'INTERNAL', retryable: true };

/** The service is unavailable (503), with Retry offered. */
export const UNAVAILABLE: ApiFailure = { status: 503, code: 'UNAVAILABLE', retryable: true };

/** Answers requests matching `url` with an error of the API. */
export async function failRequests(
  page: Page,
  url: RequestMatch,
  failure: ApiFailure = INTERNAL,
): Promise<void> {
  await page.route(url, (route) =>
    route.fulfill({
      status: failure.status,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: failure.code,
          message: 'The screen test answered with an error.',
          retryable: failure.retryable,
          requestId: 'req_screens',
        },
      }),
    }),
  );
}

/**
 * Holds requests matching `url` unanswered, so the screen stays in its loading state; the
 * returned function lets them go on.
 */
export async function holdRequests(page: Page, url: RequestMatch): Promise<() => Promise<void>> {
  const held: Route[] = [];
  await page.route(url, (route) => {
    held.push(route);
  });
  return async () => {
    await page.unroute(url);
    await Promise.all(held.map((route) => route.continue().catch(() => undefined)));
  };
}

/** Requests matching `url` never reach the server, as when the phone is offline. */
export async function dropRequests(page: Page, url: RequestMatch): Promise<void> {
  await page.route(url, (route) => route.abort('internetdisconnected'));
}

/**
 * Holds the article audio at `ms` milliseconds once it plays: it stays playing there without
 * moving on, so the player shows one moment.
 */
export async function holdAudioAt(page: Page, ms: number): Promise<void> {
  await page.waitForFunction(() => {
    const audio = (window as ScreenWindow).screenAudio;
    return audio !== undefined && !audio.paused && audio.currentTime > 0;
  });
  await page.evaluate((at) => {
    const audio = (window as ScreenWindow).screenAudio!;
    audio.playbackRate = 0;
    audio.currentTime = at / 1000;
  }, ms);
}

/** Makes the browser refuse (or again allow) to start audio without a tap. */
export async function refuseAutoplay(page: Page, refuse: boolean): Promise<void> {
  await page.evaluate((value) => {
    (window as ScreenWindow).refusePlay = value;
  }, refuse);
}
