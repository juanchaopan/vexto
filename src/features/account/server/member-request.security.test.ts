import { afterAll, describe, expect, it, vi } from 'vitest';
import { dataResult } from '../../../lib/api/responses.ts';
import { expectApiError, readSuccess } from '../../../lib/api/testing.ts';
import { closeDatabase } from '../../../lib/db/client.ts';
import { signInAsMember, signOutOfClerk } from '../testing.ts';
import { handleMemberRequest } from './member-request.ts';

// The terms gate in front of every endpoint but the profile and the acceptance
// (.docs/design/rules.md, 使用条款): the handler's own work never runs for a member who has not
// accepted the current version.

vi.mock('@clerk/nextjs/server', async () => (await import('../testing.ts')).clerkServerStandIn);
vi.mock('next/server', async () => (await import('../testing.ts')).nextServerStandIn());

afterAll(async () => {
  await closeDatabase();
});

function guardedEndpoint() {
  const work = vi.fn(async () => dataResult({ ok: true }));
  return { work, call: () => handleMemberRequest(work) };
}

describe('handleMemberRequest', () => {
  it('runs the work for a member who accepted the current terms', async () => {
    const member = await signInAsMember();
    const { work, call } = guardedEndpoint();

    expect(await readSuccess(await call())).toEqual({ data: { ok: true } });
    expect(work).toHaveBeenCalledWith(
      expect.objectContaining({ member: expect.objectContaining({ id: member.id }) }),
    );
  });

  it('answers TERMS_REQUIRED before any acceptance', async () => {
    await signInAsMember({ termsVersion: null });
    const { work, call } = guardedEndpoint();

    await expectApiError(await call(), 'TERMS_REQUIRED');
    expect(work).not.toHaveBeenCalled();
  });

  it('answers TERMS_REQUIRED when only an older version was accepted', async () => {
    await signInAsMember({ termsVersion: 0 });
    const { work, call } = guardedEndpoint();

    await expectApiError(await call(), 'TERMS_REQUIRED');
    expect(work).not.toHaveBeenCalled();
  });

  it('answers UNAUTHENTICATED without a session, before looking at the terms', async () => {
    signOutOfClerk();
    const { work, call } = guardedEndpoint();

    await expectApiError(await call(), 'UNAUTHENTICATED');
    expect(work).not.toHaveBeenCalled();
  });
});
