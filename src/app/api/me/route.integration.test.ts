import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMember,
  memberRow,
  setClerkReachable,
  signInAsMember,
  signInToClerk,
  uniqueEmail,
} from '../../../features/account/testing.ts';
import { expectApiError, readSuccess } from '../../../lib/api/testing.ts';
import { closeDatabase } from '../../../lib/db/client.ts';
import { GET } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../features/account/testing.ts')).nextServerStandIn(),
);

afterEach(() => {
  setClerkReachable(true);
});

afterAll(async () => {
  await closeDatabase();
});

describe('GET /api/me', () => {
  it('binds the Clerk user to the invited row on the first request, by verified email', async () => {
    const email = uniqueEmail();
    const member = await createMember({ email, termsVersion: null });
    const clerkUserId = signInToClerk([{ address: email.toUpperCase() }]);

    const body = await readSuccess(await GET());

    expect(body).toEqual({
      data: { email, terms: { currentVersion: 1, acceptedVersion: null, acceptedAt: null } },
    });
    expect(await memberRow(member.id)).toMatchObject({ clerkUserId, status: 'active' });
  });

  it('binds the row of another verified address when the primary one is not invited', async () => {
    const invited = uniqueEmail('second');
    const member = await createMember({ email: invited });
    const clerkUserId = signInToClerk([{ address: uniqueEmail('primary') }, { address: invited }]);

    await readSuccess(await GET());

    expect((await memberRow(member.id)).clerkUserId).toBe(clerkUserId);
  });

  it('knows a bound member without asking Clerk again', async () => {
    const member = await signInAsMember();
    setClerkReachable(false);

    const body = await readSuccess(await GET());

    expect(body).toMatchObject({ data: { email: member.email } });
  });

  it('reports the accepted terms version and time', async () => {
    await signInAsMember();

    const body = (await readSuccess(await GET())) as {
      data: { terms: { acceptedVersion: number; acceptedAt: string } };
    };

    expect(body.data.terms.acceptedVersion).toBe(1);
    expect(new Date(body.data.terms.acceptedAt).toISOString()).toBe(body.data.terms.acceptedAt);
  });

  it('answers UNAVAILABLE when Clerk cannot give the addresses of an unbound user', async () => {
    signInToClerk([{ address: uniqueEmail() }]);
    setClerkReachable(false);

    await expectApiError(await GET(), 'UNAVAILABLE');
  });
});
