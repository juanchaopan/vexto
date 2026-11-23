import { afterAll, describe, expect, it, vi } from 'vitest';
import { memberRow, signInAsMember } from '../../../../features/account/testing.ts';
import { expectApiError, jsonRequest, readSuccess } from '../../../../lib/api/testing.ts';
import { closeDatabase } from '../../../../lib/db/client.ts';
import { GET } from '../../me/route.ts';
import { POST } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../../features/account/testing.ts')).nextServerStandIn(),
);

afterAll(async () => {
  await closeDatabase();
});

const accept = (body: unknown) => POST(jsonRequest('/api/terms/acceptance', body));

type Acceptance = { data: { acceptedVersion: number; acceptedAt: string } };

describe('POST /api/terms/acceptance', () => {
  it('records the version and the time, and the profile shows them', async () => {
    const member = await signInAsMember({ termsVersion: null });
    const before = Date.now();

    const body = (await readSuccess(await accept({ version: 1 }))) as Acceptance;

    expect(body.data.acceptedVersion).toBe(1);
    expect(Date.parse(body.data.acceptedAt)).toBeGreaterThanOrEqual(before - 1000);
    const row = await memberRow(member.id);
    expect(row.termsVersion).toBe(1);
    expect(row.termsAcceptedAt?.toISOString()).toBe(body.data.acceptedAt);
    expect(await readSuccess(await GET())).toMatchObject({
      data: { terms: { currentVersion: 1, acceptedVersion: 1, acceptedAt: body.data.acceptedAt } },
    });
  });

  it('answers the original time when the version was accepted before', async () => {
    await signInAsMember({ termsVersion: null });
    const first = (await readSuccess(await accept({ version: 1 }))) as Acceptance;

    const again = (await readSuccess(await accept({ version: 1 }))) as Acceptance;

    expect(again).toEqual(first);
  });

  it('agrees on one time when the same acceptance arrives twice at once', async () => {
    await signInAsMember({ termsVersion: null });

    const [a, b] = await Promise.all([accept({ version: 1 }), accept({ version: 1 })]);

    expect(await readSuccess(a)).toEqual(await readSuccess(b));
  });

  it('records a new time when an older version was accepted', async () => {
    const member = await signInAsMember({ termsVersion: 0 });
    const old = (await memberRow(member.id)).termsAcceptedAt?.toISOString();

    const body = (await readSuccess(await accept({ version: 1 }))) as Acceptance;

    expect(body.data.acceptedVersion).toBe(1);
    expect(body.data.acceptedAt).not.toBe(old);
    expect((await memberRow(member.id)).termsAcceptedAt?.toISOString()).toBe(body.data.acceptedAt);
  });

  it('refuses a version that is not the current one and records nothing', async () => {
    const member = await signInAsMember({ termsVersion: null });

    await expectApiError(await accept({ version: 2 }), 'CONFLICT');

    expect(await memberRow(member.id)).toMatchObject({ termsVersion: null, termsAcceptedAt: null });
  });
});
