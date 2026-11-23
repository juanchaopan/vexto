// Queries on the members table for the web application (.docs/design/rules.md, 成员和登录 and
// 使用条款): finding the active member of a Clerk user, binding a Clerk user to an invited row on
// its first request, and recording the accepted terms version.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import type { TermsAcceptance } from '../domain/terms.ts';
import { members } from './schema.ts';

/** The signed-in member a request acts for. */
export type Member = TermsAcceptance & { id: string; email: string };

const memberColumns = {
  id: members.id,
  email: members.email,
  termsVersion: members.termsVersion,
  termsAcceptedAt: members.termsAcceptedAt,
};

/** The active member bound to this Clerk user, if any. */
export async function findActiveMember(
  db: Executor,
  clerkUserId: string,
): Promise<Member | undefined> {
  const [member] = await db
    .select(memberColumns)
    .from(members)
    .where(and(eq(members.clerkUserId, clerkUserId), eq(members.status, 'active')));
  return member;
}

const UNIQUE_VIOLATION = '23505';

/** True when the error, or the driver error it wraps, is a unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; typeof current === 'object' && current !== null;) {
    if ('code' in current && current.code === UNIQUE_VIOLATION) {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

async function bindByEmail(db: Executor, clerkUserId: string, email: string) {
  const [member] = await db
    .update(members)
    .set({ clerkUserId })
    .where(and(eq(members.email, email), eq(members.status, 'active'), isNull(members.clerkUserId)))
    .returning(memberColumns);
  return member;
}

/**
 * Binds the Clerk user to the active, unbound member row of one of its verified email addresses,
 * trying them in order, and returns that member. A row bound to another Clerk user is never
 * taken over. When two first requests of the same Clerk user race, the one that loses finds the
 * member the other one bound.
 */
export async function bindActiveMember(
  db: Executor,
  clerkUserId: string,
  emails: readonly string[],
): Promise<Member | undefined> {
  try {
    for (const email of emails) {
      const member = await bindByEmail(db, clerkUserId, email);
      if (member) {
        return member;
      }
    }
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }
  return findActiveMember(db, clerkUserId);
}

/**
 * Records that the member accepted this terms version, in one statement so that concurrent
 * acceptances agree: the first acceptance of a version sets the time, and accepting the same
 * version again keeps the original time. Answers nothing when the member is no longer active.
 */
export async function recordTermsAcceptance(
  db: Executor,
  memberId: string,
  version: number,
): Promise<TermsAcceptance | undefined> {
  const [acceptance] = await db
    .update(members)
    .set({
      termsVersion: version,
      termsAcceptedAt: sql`case when ${members.termsVersion} = ${version} and ${members.termsAcceptedAt} is not null then ${members.termsAcceptedAt} else now() end`,
    })
    .where(and(eq(members.id, memberId), eq(members.status, 'active')))
    .returning({ termsVersion: members.termsVersion, termsAcceptedAt: members.termsAcceptedAt });
  return acceptance;
}
