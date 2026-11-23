import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors.ts';
import { lockActiveMember } from './active-member.ts';
import { closeDatabase, getDatabase, inTransaction } from './client.ts';
import { members, type MemberStatus } from './schema.ts';
import { revokeHeldOpen } from './testing.ts';

// The tests run against the throwaway database the integration setup migrated, each with a
// member of its own.

const db = getDatabase();

afterAll(async () => {
  await closeDatabase();
});

async function newMember(status: MemberStatus = 'active'): Promise<string> {
  const [member] = await db
    .insert(members)
    .values({ email: `active-member-${randomUUID()}@example.com`, status })
    .returning({ id: members.id });
  return member.id;
}

/** A write transaction of the member's: what it answers, or the error it was refused with. */
function write(memberId: string): Promise<unknown> {
  return inTransaction(async (tx) => {
    await lockActiveMember(tx, memberId);
    return 'written';
  }).catch((error: unknown) => error);
}

describe('lockActiveMember', () => {
  it('lets the transaction of an active member go on', async () => {
    expect(await write(await newMember())).toBe('written');
  });

  it('refuses a revoked member and one who is not on the list as NOT_A_MEMBER', async () => {
    for (const memberId of [await newMember('revoked'), randomUUID()]) {
      const refused = await write(memberId);

      expect(refused).toBeInstanceOf(ApiError);
      expect(refused).toMatchObject({ code: 'NOT_A_MEMBER', status: 403 });
    }
  });

  it('waits for a revoke that holds the member, then refuses the member it revoked', async () => {
    const memberId = await newMember();
    const revoke = await revokeHeldOpen(db, memberId);

    const writing = write(memberId);
    await revoke.waitedFor();
    await revoke.commit();

    expect(await writing).toMatchObject({ code: 'NOT_A_MEMBER' });
  });
});
