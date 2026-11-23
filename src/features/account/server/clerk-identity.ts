// Who is signed in, according to Clerk. The session comes from the request that the proxy
// (src/proxy.ts) authenticated; the email addresses come from Clerk's Backend API and are read
// only when the session's Clerk user is not bound to a member yet.
import { auth, clerkClient } from '@clerk/nextjs/server';
import { ApiError } from '../../../lib/api/errors.ts';
import { verifiedEmails } from '../domain/verified-emails.ts';

/** The Clerk user ID of the request's session, or null when no one is signed in. */
export async function signedInClerkUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/**
 * The verified email addresses of a Clerk user, primary first. A Clerk outage is answered as
 * UNAVAILABLE, since repeating the request later can succeed.
 */
export async function clerkVerifiedEmails(userId: string): Promise<string[]> {
  let user;
  try {
    user = await (await clerkClient()).users.getUser(userId);
  } catch {
    throw new ApiError('UNAVAILABLE', 'The sign-in service could not be reached.');
  }
  return verifiedEmails(
    user.emailAddresses.map((email) => ({
      id: email.id,
      address: email.emailAddress,
      verified: email.verification?.status === 'verified',
    })),
    user.primaryEmailAddressId,
  );
}
