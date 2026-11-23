import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { members } from '../../../features/account/index.ts';
import {
  actAsClerkUser,
  createMember,
  memberRow,
  signInAsMember,
  signInToClerk,
  signOutOfClerk,
  uniqueEmail,
} from '../../../features/account/testing.ts';
import { expectApiError, jsonRequest, readSuccess } from '../../../lib/api/testing.ts';
import { closeDatabase, getDatabase } from '../../../lib/db/client.ts';
import { POST as acceptTerms } from '../terms/acceptance/route.ts';
import { GET } from './route.ts';

// Who may use the account endpoints (.docs/design/rules.md, 成员和登录, 权限和数据隔离 and
// 取消资格): only a signed-in Google account bound to an active member, decided from the Clerk
// session and the members table on every request, never from what the client sends.

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../features/account/testing.ts')).nextServerStandIn(),
);

afterAll(async () => {
  await closeDatabase();
});

const accept = (body: unknown = { version: 1 }) =>
  acceptTerms(jsonRequest('/api/terms/acceptance', body));

/** Revokes the member the way `task member revoke` leaves the row. */
async function revoke(memberId: string) {
  await getDatabase()
    .update(members)
    .set({ status: 'revoked', clerkUserId: null, termsVersion: null, termsAcceptedAt: null })
    .where(eq(members.id, memberId));
}

describe('without a session', () => {
  it('answers UNAUTHENTICATED, before reading the body', async () => {
    signOutOfClerk();

    await expectApiError(await GET(), 'UNAUTHENTICATED');
    await expectApiError(await accept('not json'), 'UNAUTHENTICATED');
  });
});

describe('a Google account that is not an active member', () => {
  it('is refused when its email is not on the list', async () => {
    signInToClerk([{ address: uniqueEmail('stranger') }]);

    await expectApiError(await GET(), 'NOT_A_MEMBER');
    await expectApiError(await accept(), 'NOT_A_MEMBER');
  });

  it('is not bound by an unverified email address', async () => {
    const email = uniqueEmail();
    const member = await createMember({ email });
    signInToClerk([{ address: email, verified: false }]);

    await expectApiError(await GET(), 'NOT_A_MEMBER');
    expect((await memberRow(member.id)).clerkUserId).toBeNull();
  });

  it('cannot take over a row bound to another Clerk user', async () => {
    const owner = await signInAsMember();
    signInToClerk([{ address: owner.email }]);

    await expectApiError(await GET(), 'NOT_A_MEMBER');
    expect((await memberRow(owner.id)).clerkUserId).toBe(owner.clerkUserId);
  });

  it('is refused when its row is revoked', async () => {
    const email = uniqueEmail();
    await createMember({ email, status: 'revoked', termsVersion: null });
    signInToClerk([{ address: email }]);

    await expectApiError(await GET(), 'NOT_A_MEMBER');
  });

  it('is refused when its row is revoked but still names the Clerk user', async () => {
    const member = await signInAsMember();
    await getDatabase().update(members).set({ status: 'revoked' }).where(eq(members.id, member.id));

    await expectApiError(await GET(), 'NOT_A_MEMBER');
    await expectApiError(await accept(), 'NOT_A_MEMBER');
  });
});

describe('a revoked member', () => {
  it('is refused on the very next request', async () => {
    const member = await signInAsMember();
    await readSuccess(await GET());

    await revoke(member.id);

    await expectApiError(await GET(), 'NOT_A_MEMBER');
    await expectApiError(await accept(), 'NOT_A_MEMBER');
    expect(await memberRow(member.id)).toMatchObject({ termsVersion: null, clerkUserId: null });
  });
});

describe('each member', () => {
  it('reads only its own profile', async () => {
    const ann = await signInAsMember({ email: uniqueEmail('ann') });
    const bo = await signInAsMember({ email: uniqueEmail('bo'), termsVersion: null });

    actAsClerkUser(ann.clerkUserId);
    expect(await readSuccess(await GET())).toMatchObject({ data: { email: ann.email } });
    actAsClerkUser(bo.clerkUserId);
    expect(await readSuccess(await GET())).toMatchObject({ data: { email: bo.email } });
  });

  it('accepts the terms for itself only', async () => {
    const ann = await signInAsMember({ termsVersion: null });
    const bo = await signInAsMember({ termsVersion: null });

    actAsClerkUser(ann.clerkUserId);
    await readSuccess(await accept());

    expect((await memberRow(ann.id)).termsVersion).toBe(1);
    expect(await memberRow(bo.id)).toMatchObject({ termsVersion: null, termsAcceptedAt: null });
  });

  it('cannot name another member in the request', async () => {
    const ann = await signInAsMember({ termsVersion: null });
    const bo = await signInAsMember({ termsVersion: null });
    actAsClerkUser(ann.clerkUserId);

    await expectApiError(await accept({ version: 1, memberId: bo.id }), 'INVALID_INPUT');
    await expectApiError(
      await accept({ version: 1, clerkUserId: bo.clerkUserId }),
      'INVALID_INPUT',
    );
    expect((await memberRow(bo.id)).termsVersion).toBeNull();
  });
});
