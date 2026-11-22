// Usage records (.docs/design/rules.md, 用量记录): every actual call to the AI or to speech
// synthesis gets a `pending` row just before it is made, and the row is completed with the
// provider's request ID, the usage, the status and the price version once the outcome is known.
// Usage that is not known stays null and is never written as 0. The records are written on the
// database itself, outside any transaction, as external calls are.
import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import type { FinishedUsageStatus, UsageKind } from '../domain/usage.ts';
import { usageRecords } from './schema.ts';

export type UsageStart = {
  kind: UsageKind;
  provider: string;
  model: string;
  engineRevision?: string;
  /** The member the call is for; calls of the collection job have none. */
  ownerId?: string;
  resourceType?: string;
  resourceId?: string;
};

export type UsageOutcome = {
  status: FinishedUsageStatus;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  audioMs?: number;
  cpuMs?: number;
  byteCount?: number;
  /** Estimated cost in dollars, as a decimal string such as "0.000420". */
  estimatedCost?: string;
  priceVersion?: string;
  errorCode?: string;
};

/** Records that a call is about to be made and returns the record's ID. */
export async function startUsage(executor: Executor, start: UsageStart): Promise<string> {
  const [record] = await executor
    .insert(usageRecords)
    .values({ ...start, status: 'pending', startedAt: sql`now()` })
    .returning({ id: usageRecords.id });
  return record.id;
}

/** Completes a record with the call's outcome; fields left out stay null. */
export async function finishUsage(
  executor: Executor,
  id: string,
  outcome: UsageOutcome,
): Promise<void> {
  await executor
    .update(usageRecords)
    .set({ ...outcome, finishedAt: sql`now()` })
    .where(eq(usageRecords.id, id));
}

/** What a tracked call reports: its result and the usage it learned. */
export type TrackedCall<T> = { result: T; outcome: UsageOutcome };

/**
 * Makes one external call between a pending record and its outcome. When the call throws,
 * `outcomeOfError` says whether it failed or its outcome is unknown (such as a timeout, where the
 * provider may still have done the work), the record is completed with that, and the error is
 * thrown on.
 */
export async function trackUsage<T>(
  executor: Executor,
  start: UsageStart,
  call: () => Promise<TrackedCall<T>>,
  outcomeOfError: (error: unknown) => UsageOutcome,
): Promise<T> {
  const id = await startUsage(executor, start);
  let tracked: TrackedCall<T>;
  try {
    tracked = await call();
  } catch (error) {
    await finishUsage(executor, id, outcomeOfError(error));
    throw error;
  }
  await finishUsage(executor, id, tracked.outcome);
  return tracked.result;
}
