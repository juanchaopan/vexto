// Test kit for code behind the member check: a stand-in for Clerk's server SDK, and members
// created in the test database, so integration and security tests of any Route Handler can act
// as a signed-in member, a Google account that is not a member, or no one. Only test files import
// this module. A test file replaces the SDK and Next.js's request wait with:
//
//   vi.mock('@clerk/nextjs/server', async () => (await import('<path>/testing.ts')).clerkServerStandIn);
//   vi.mock('next/server', async () => (await import('<path>/testing.ts')).nextServerStandIn());
//
// Every helper makes its own email addresses and Clerk user IDs, so test files running side by
// side never meet each other's rows.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sharedConfig } from '../../lib/config/shared-config.ts';
import { getDatabase } from '../../lib/db/client.ts';
import type { MemberStatus } from './domain/member.ts';
import { members } from './server/schema.ts';

type ClerkEmail = { id: string; emailAddress: string; verification: { status: string } | null };
type ClerkUser = { id: string; primaryEmailAddressId: string | null; emailAddresses: ClerkEmail[] };

const clerk = {
  sessionUserId: null as string | null,
  users: new Map<string, ClerkUser>(),
  reachable: true,
};

/** Stands in for `@clerk/nextjs/server`: the session and the Backend API's users. */
export const clerkServerStandIn = {
  auth: async () => ({ userId: clerk.sessionUserId }),
  clerkClient: async () => ({
    users: {
      getUser: async (userId: string) => {
        const user = clerk.users.get(userId);
        if (!clerk.reachable || !user) {
          throw new Error(`Clerk could not answer for ${userId}.`);
        }
        return user;
      },
    },
  }),
};

/**
 * Stands in for `next/server`, with `connection()` resolving at once: outside the Next.js server
 * there is no request to wait for.
 */
export async function nextServerStandIn() {
  const actual = await import('next/server');
  return { ...actual, connection: async () => undefined };
}

export type TestEmail = { address: string; verified?: boolean };

/**
 * Makes a Clerk user with these email addresses (verified unless said otherwise, the first one
 * primary) and signs it in; returns its Clerk user ID.
 */
export function signInToClerk(emails: readonly TestEmail[]): string {
  const id = `user_${randomUUID()}`;
  const emailAddresses = emails.map((email) => ({
    id: `idn_${randomUUID()}`,
    emailAddress: email.address,
    verification: { status: email.verified === false ? 'unverified' : 'verified' },
  }));
  clerk.users.set(id, { id, primaryEmailAddressId: emailAddresses[0]?.id ?? null, emailAddresses });
  clerk.sessionUserId = id;
  return id;
}

/** Makes this Clerk user the session again, as when the same person sends another request. */
export function actAsClerkUser(clerkUserId: string | null): void {
  clerk.sessionUserId = clerkUserId;
}

/** Ends the Clerk session: requests are sent by no one. */
export function signOutOfClerk(): void {
  clerk.sessionUserId = null;
}

/** Makes Clerk's Backend API unreachable, or reachable again. */
export function setClerkReachable(reachable: boolean): void {
  clerk.reachable = reachable;
}

/** A lower-case email address no other test uses. */
export function uniqueEmail(label = 'member'): string {
  return `${label}-${randomUUID()}@example.com`;
}

export type MemberOptions = {
  email?: string;
  status?: MemberStatus;
  clerkUserId?: string | null;
  /** The accepted terms version: the current one by default, null for none. */
  termsVersion?: number | null;
};

/** Inserts a member row and returns its ID and email. */
export async function createMember(options: MemberOptions = {}) {
  const termsVersion =
    options.termsVersion === undefined ? sharedConfig.terms.version : options.termsVersion;
  const [member] = await getDatabase()
    .insert(members)
    .values({
      email: options.email ?? uniqueEmail(),
      status: options.status ?? 'active',
      clerkUserId: options.clerkUserId ?? null,
      termsVersion,
      termsAcceptedAt: termsVersion === null ? null : new Date(),
    })
    .returning({ id: members.id, email: members.email });
  return member;
}

/**
 * Signs in as a new member: a member row bound to a new Clerk user with the same email. Pass
 * `termsVersion: null` for a member who has not accepted the terms yet.
 */
export async function signInAsMember(options: Omit<MemberOptions, 'clerkUserId'> = {}) {
  const email = options.email ?? uniqueEmail();
  const clerkUserId = signInToClerk([{ address: email }]);
  const member = await createMember({ ...options, email, clerkUserId });
  return { ...member, clerkUserId };
}

/** The member row as the database holds it now. */
export async function memberRow(id: string) {
  const [row] = await getDatabase().select().from(members).where(eq(members.id, id));
  return row;
}
