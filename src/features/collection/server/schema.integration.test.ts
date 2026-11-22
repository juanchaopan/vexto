import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, inTransaction, type Transaction } from '../../../lib/db/client.ts';
import { COLLECT_LEASE_NAME } from '../domain/collection-state.ts';
import { jobLeases } from './schema.ts';

// The migration leaves one lease row for the collection job, already expired. These cases take
// and release it the way rules.md describes, inside transactions that are rolled back, so the row
// stays as the migration left it for the other tests.

afterAll(async () => {
  await closeDatabase();
});

class Rollback extends Error {}

async function rolledBack(work: (tx: Transaction) => Promise<void>) {
  await expect(
    inTransaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

/** The atomic take: only an expired lease is given to the new holder, for 70 minutes. */
async function take(tx: Transaction, holder: string) {
  const taken = await tx
    .update(jobLeases)
    .set({ holder, expiresAt: sql`now() + interval '70 minutes'` })
    .where(and(eq(jobLeases.name, COLLECT_LEASE_NAME), sql`${jobLeases.expiresAt} < now()`))
    .returning({ holder: jobLeases.holder });
  return taken.length === 1;
}

describe('the collection lease row', () => {
  it('exists after the migration and has expired, so the first run can take it', async () => {
    await rolledBack(async (tx) => {
      const leases = await tx
        .select({ name: jobLeases.name, holder: jobLeases.holder })
        .from(jobLeases)
        .where(sql`${jobLeases.expiresAt} = '-infinity'`);

      expect(leases).toEqual([{ name: COLLECT_LEASE_NAME, holder: null }]);
    });
  });

  it('is taken by one run at a time until the holder releases it', async () => {
    await rolledBack(async (tx) => {
      const first = randomUUID();

      expect(await take(tx, first)).toBe(true);
      expect(await take(tx, randomUUID())).toBe(false);

      const released = await tx
        .update(jobLeases)
        .set({ expiresAt: sql`now() - interval '1 microsecond'` })
        .where(and(eq(jobLeases.name, COLLECT_LEASE_NAME), eq(jobLeases.holder, first)))
        .returning({ name: jobLeases.name });
      expect(released).toHaveLength(1);
      expect(await take(tx, randomUUID())).toBe(true);
    });
  });
});
