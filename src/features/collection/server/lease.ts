// The lease that keeps two runs of the collection job from overlapping (.docs/design/rules.md,
// 防止重叠的租约). The lease is one row, taken with one atomic UPDATE that only succeeds once the
// row's expiry has passed by the database's clock, so it works over the pooled connection without
// session locks. A run gives the lease back when it ends; one that was stopped lets it run out.
import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import { COLLECT_LEASE_NAME, LEASE_MINUTES } from '../domain/collection-state.ts';
import { jobLeases } from './schema.ts';

/** Takes the lease for this run; false when another run holds it. */
export async function takeCollectionLease(executor: Executor, holder: string): Promise<boolean> {
  const taken = await executor
    .update(jobLeases)
    .set({ holder, expiresAt: sql`now() + make_interval(mins => ${LEASE_MINUTES}::int)` })
    .where(and(eq(jobLeases.name, COLLECT_LEASE_NAME), sql`${jobLeases.expiresAt} < now()`))
    .returning({ name: jobLeases.name });
  return taken.length === 1;
}

/** Lets the lease this run holds expire at once; a lease another run took is left alone. */
export async function releaseCollectionLease(executor: Executor, holder: string): Promise<void> {
  await executor
    .update(jobLeases)
    .set({ expiresAt: sql`now()` })
    .where(and(eq(jobLeases.name, COLLECT_LEASE_NAME), eq(jobLeases.holder, holder)));
}
