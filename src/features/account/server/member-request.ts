// The checks every Route Handler of the web application runs before its own work
// (.docs/design/interfaces.md, 身份和条款), in this order: a Clerk session (401 UNAUTHENTICATED),
// an active member bound to it (403 NOT_A_MEMBER), and the current terms version accepted
// (403 TERMS_REQUIRED). The member is looked up on every request, so a revoked member is refused
// on the next one; nothing the client sends is used to decide who the member is.
import { connection } from 'next/server';
import { ApiError } from '../../../lib/api/errors.ts';
import type { ApiResult } from '../../../lib/api/responses.ts';
import { handleRequest, type RequestScope } from '../../../lib/api/route.ts';
import { getDatabase } from '../../../lib/db/client.ts';
import { sharedConfig } from '../../../lib/config/shared-config.ts';
import { hasAcceptedTerms } from '../domain/terms.ts';
import { clerkVerifiedEmails, signedInClerkUserId } from './clerk-identity.ts';
import { bindActiveMember, findActiveMember, type Member } from './member-records.ts';

export type MemberScope = RequestScope & { member: Member };

export type MemberRequestOptions = {
  /**
   * Whether the member must have accepted the current terms. Only reading one's own profile and
   * accepting the terms work before that.
   */
  terms: 'required' | 'not-required';
};

/**
 * The active member of the signed-in Clerk user. The first request of a Clerk user binds it to
 * the invited row of one of its verified email addresses; Clerk is asked for those addresses
 * only while the user is not bound to an active member.
 */
export async function requireMember(options: MemberRequestOptions): Promise<Member> {
  const clerkUserId = await signedInClerkUserId();
  if (!clerkUserId) {
    throw new ApiError('UNAUTHENTICATED', 'Sign in first.');
  }
  const db = getDatabase();
  const member =
    (await findActiveMember(db, clerkUserId)) ??
    (await bindActiveMember(db, clerkUserId, await clerkVerifiedEmails(clerkUserId)));
  if (!member) {
    throw new ApiError('NOT_A_MEMBER', 'This account is not on the member list.');
  }
  if (options.terms === 'required' && !hasAcceptedTerms(member, sharedConfig.terms.version)) {
    throw new ApiError('TERMS_REQUIRED', 'Accept the current terms of use first.');
  }
  return member;
}

/**
 * Runs a handler for the signed-in member, inside the frame of handleRequest. It first waits for
 * an actual request, so the build never prerenders a member's answer, and the frame never mistakes
 * the build's interruption for a failed request.
 */
export async function handleMemberRequest(
  work: (scope: MemberScope) => Promise<ApiResult>,
  options: MemberRequestOptions = { terms: 'required' },
): Promise<Response> {
  await connection();
  return handleRequest(async (scope) => work({ ...scope, member: await requireMember(options) }));
}
