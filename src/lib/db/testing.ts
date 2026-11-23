// Test kit for races with `task member -- revoke`. Only test files import this module.
//
// - revokeHeldOpen(): a revoke that holds the member's row and has set it revoked, but has not
//   committed yet, so a test can start a statement that has to wait for it, see that it waits,
//   and then let the revoke commit.
import { eq, sql } from 'drizzle-orm';
import { expect, vi } from 'vitest';
import type { Database } from './client.ts';
import { members } from './schema.ts';

/** A promise with the function that settles it. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

export type HeldRevoke = {
  /** Resolves once a statement of another session waits for the revoke's lock. */
  waitedFor(): Promise<void>;
  /** Lets the revoke commit and resolves when it has. */
  commit(): Promise<void>;
};

/** Starts revoking the member in a transaction that stays open until `commit` is called. */
export async function revokeHeldOpen(database: Database, memberId: string): Promise<HeldRevoke> {
  const release = deferred<undefined>();
  const revokerPid = deferred<number>();
  const revoking = database.transaction(async (tx) => {
    await tx.select().from(members).where(eq(members.id, memberId)).for('update');
    await tx.update(members).set({ status: 'revoked' }).where(eq(members.id, memberId));
    const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    revokerPid.settle(row.pid);
    await release.promise;
  });
  const pid = await revokerPid.promise;
  return {
    async waitedFor() {
      await vi.waitFor(async () => {
        const [row] = await database.execute<{ waiting: number }>(
          sql`select count(*)::int as waiting from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`,
        );
        expect(row.waiting).toBe(1);
      });
    },
    async commit() {
      release.settle(undefined);
      await revoking;
    },
  };
}
