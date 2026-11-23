// The member check inside a write transaction (.docs/design/rules.md, 取消资格). Every request
// checks the member before its work, but a request can pass that check just before `task member
// -- revoke` and write after the revoke has removed the member's data, for example once a
// seconds-long AI call returns. So every transaction that writes a member's own data first holds
// the member's row and checks again that the member is active. The revoke holds the same row
// while it removes the data: a write that holds it first commits before the revoke runs, whose
// deletions then remove it too, and a write that comes after waits for the revoke to commit and
// finds the member revoked.
import { eq } from 'drizzle-orm';
import { ApiError } from '../api/errors.ts';
import type { Transaction } from './client.ts';
import { members } from './schema.ts';

/**
 * Holds the member's row until the transaction ends, so the member's writes take turns with each
 * other and with a revoke; NOT_A_MEMBER, as at the member check, when the member is not active.
 * Call it before the transaction takes any other lock, so every writer takes the locks in the
 * same order as the revoke.
 */
export async function lockActiveMember(tx: Transaction, memberId: string): Promise<void> {
  const [member] = await tx
    .select({ status: members.status })
    .from(members)
    .where(eq(members.id, memberId))
    .for('update');
  if (member?.status !== 'active') {
    throw new ApiError('NOT_A_MEMBER', 'This account is not on the member list.');
  }
}
