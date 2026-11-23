// Entries the job has seen, collected or skipped (.docs/design/data.md, seen_items), keyed by the
// hash of their normalized address. An entry with a row is never fetched again.
import { inArray } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import { seenItems } from './schema.ts';

/** The hashes among these that have a row. */
export async function seenUrlHashes(executor: Executor, hashes: readonly string[]) {
  if (hashes.length === 0) {
    return new Set<string>();
  }
  const rows = await executor
    .select({ urlHash: seenItems.urlHash })
    .from(seenItems)
    .where(inArray(seenItems.urlHash, [...hashes]));
  return new Set(rows.map((row) => row.urlHash));
}

export async function markSeen(executor: Executor, urlHash: string, at: Date) {
  await executor
    .insert(seenItems)
    .values({ urlHash, firstSeenAt: at })
    .onConflictDoNothing({ target: seenItems.urlHash });
}
