import { clerk } from '@clerk/testing/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

// Test accounts in the Clerk development instance the application runs against. The tests sign
// in with Clerk's testing helpers (@clerk/testing), which create a sign-in token for an existing
// user through Clerk's Backend API, so each account is made once and then reused by later runs.
// Addresses with the +clerk_test subaddress are Clerk test addresses: no email is ever sent.

const clerkApi = 'https://api.clerk.com/v1';

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

async function clerkRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${clerkApi}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
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

/** Makes sure a Clerk user with this verified address exists. */
export async function ensureClerkUser(email: string): Promise<void> {
  const found = (await clerkRequest(
    `/users?email_address=${encodeURIComponent(email)}`,
  )) as unknown[];
  if (found.length > 0) {
    return;
  }
  await clerkRequest('/users', {
    method: 'POST',
    body: JSON.stringify({ email_address: [email], skip_password_requirement: true }),
  });
}

/**
 * Signs the Clerk user with this address in from the sign-in page `page` shows, and returns a new
 * page of the same browser context, signed in, at `path`. Once signed in, the sign-in page may
 * navigate on its own, so the application opens in a page of its own; it opens only after Clerk
 * has written the session's cookies, which the server reads.
 */
export async function signInAndOpen(page: Page, email: string, path: string): Promise<Page> {
  await clerk.signIn({ page, emailAddress: email });
  const context = page.context();
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
