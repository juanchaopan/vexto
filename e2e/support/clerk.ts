import { setTimeout as delay } from 'node:timers/promises';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

// Test accounts in the Clerk development instance the application runs against. Each account is
// made once through Clerk's Backend API and reused by later runs; addresses with the +clerk_test
// subaddress are Clerk test addresses, so no email is ever sent.
//
// Signing in uses Clerk's testing mode: `clerkSetup()` from @clerk/testing/playwright puts the
// instance's Frontend API host and a testing token into the environment, the token is added to
// every Frontend API request of the browser context, and the member signs in with a one-time
// sign-in token made through the Backend API.
//
// The browser sends its Frontend API requests itself; only their address changes on the way.
// The request handler of @clerk/testing instead fetches each of them again from the test process
// and answers the page with that copy. In full runs such a copy at times hung for about 20
// seconds before its connection was reset, while Clerk gives the account request of a loading
// page 7 seconds: the page then went on without the account, the avatar stayed empty, and Clerk
// could lose the session's cookies.

const clerkApi = 'https://api.clerk.com/v1';

/** Reading or renaming a user is sent again when the request did not get through. */
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

/** How long a sign-in token made for a test stays valid. */
const SIGN_IN_TOKEN_SECONDS = 300;

/** The query parameter that carries Clerk's testing token. */
const TESTING_TOKEN_PARAMETER = '__clerk_testing_token';

function secretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) {
    throw new Error(
      'CLERK_SECRET_KEY is not set: the end-to-end tests sign in through the Clerk development ' +
        'instance. Pull it into .env.local with `task env-pull`, or set it in the environment.',
    );
  }
  return key;
}

function send(path: string, init: RequestInit) {
  return fetch(`${clerkApi}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

/**
 * Calls Clerk's Backend API. A GET or PATCH that gets no answer, as when the network drops for a
 * moment, is sent again; a POST is sent once, since it may have arrived.
 */
async function clerkRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const repeatable = (init.method ?? 'GET') !== 'POST';
  let response: Response | undefined;
  for (let attempt = 1; !response; attempt += 1) {
    try {
      response = await send(path, init);
    } catch (error) {
      if (!repeatable || attempt >= ATTEMPTS) {
        throw error;
      }
      await delay(RETRY_DELAY_MS);
    }
  }
  if (!response.ok) {
    throw new Error(`Clerk's Backend API answered ${path} with ${response.status}.`);
  }
  return response.json();
}

/** A Clerk test address of this run's browser project, so projects running side by side differ. */
export function testEmail(role: string, testInfo: TestInfo): string {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `vexto-e2e-${role}-${project}+clerk_test@example.com`;
}

/** The name on a Clerk account, which the avatar shows as initials. */
export type PersonName = { firstName: string; lastName: string };

type ClerkUser = { id: string; first_name: string | null; last_name: string | null };

async function findClerkUser(email: string): Promise<ClerkUser | undefined> {
  const [found] = (await clerkRequest(
    `/users?email_address=${encodeURIComponent(email)}`,
  )) as ClerkUser[];
  return found;
}

/**
 * Makes sure a Clerk user with this verified address exists, carrying `name` when one is given;
 * an existing user with another name is renamed.
 */
export async function ensureClerkUser(email: string, name?: PersonName): Promise<void> {
  const names = name ? { first_name: name.firstName, last_name: name.lastName } : {};
  const found = await findClerkUser(email);
  if (!found) {
    await clerkRequest('/users', {
      method: 'POST',
      body: JSON.stringify({ email_address: [email], skip_password_requirement: true, ...names }),
    });
    return;
  }
  if (name && (found.first_name !== name.firstName || found.last_name !== name.lastName)) {
    await clerkRequest(`/users/${found.id}`, { method: 'PATCH', body: JSON.stringify(names) });
  }
}

const testingContexts = new WeakSet<BrowserContext>();

/**
 * Adds Clerk's testing token to every Frontend API request of the browser context, so Clerk's
 * bot protection lets the tests through. The browser sends the requests itself.
 */
export async function allowClerkTesting(context: BrowserContext): Promise<void> {
  if (testingContexts.has(context)) {
    return;
  }
  const frontendApi = process.env.CLERK_FAPI;
  const testingToken = process.env.CLERK_TESTING_TOKEN;
  if (!frontendApi || !testingToken) {
    throw new Error('Call clerkSetup() from @clerk/testing/playwright before signing in.');
  }
  testingContexts.add(context);
  await context.route(
    (url) => url.host === frontendApi && url.pathname.startsWith('/v1/'),
    (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set(TESTING_TOKEN_PARAMETER, testingToken);
      return route.continue({ url: url.toString() });
    },
  );
}

/** A one-time sign-in token for the Clerk user with this address. */
async function signInTicket(email: string): Promise<string> {
  const user = await findClerkUser(email);
  if (!user) {
    throw new Error(`There is no Clerk user with the address ${email}.`);
  }
  const { token } = (await clerkRequest('/sign_in_tokens', {
    method: 'POST',
    body: JSON.stringify({ user_id: user.id, expires_in_seconds: SIGN_IN_TOKEN_SECONDS }),
  })) as { token: string };
  return token;
}

/**
 * Signs the Clerk user with this address in from the sign-in page `page` shows, and returns a new
 * page of the same browser context, signed in, at `path`. Once signed in, the sign-in page may
 * navigate on its own, so the application opens in a page of its own; it opens only after Clerk
 * has written the session's cookies, which the server reads.
 */
export async function signInAndOpen(page: Page, email: string, path: string): Promise<Page> {
  const context = page.context();
  await allowClerkTesting(context);
  const ticket = await signInTicket(email);
  await page.waitForFunction(() => window.Clerk?.loaded === true);
  await page.evaluate(async (signInToken) => {
    const clerk = window.Clerk!;
    const attempt = await clerk.client!.signIn.create({ strategy: 'ticket', ticket: signInToken });
    if (attempt.status !== 'complete') {
      throw new Error(`Signing in with the sign-in token ended as ${attempt.status}.`);
    }
    await clerk.setActive({ session: attempt.createdSessionId });
  }, ticket);
  await expect
    .poll(async () => {
      const cookies = await context.cookies();
      return cookies.some((cookie) => cookie.name === '__client_uat' && cookie.value !== '0');
    })
    .toBe(true);
  const signedIn = await context.newPage();
  await page.close();
  await signedIn.goto(path);
  return signedIn;
}
