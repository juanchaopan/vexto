// Each feed's cursor (.docs/design/data.md, feed_cursors): the last collection time it has
// processed, and the failed reads of the next one with the time it may be read again.
import { eq } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import { feedCursors } from './schema.ts';

export type FeedCursor = typeof feedCursors.$inferSelect;

export async function readFeedCursors(executor: Executor): Promise<Map<string, FeedCursor>> {
  const cursors = await executor.select().from(feedCursors);
  return new Map(cursors.map((cursor) => [cursor.feedKey, cursor]));
}

/** Starts a new feed's cursor at a collection time, so collection begins with the next one. */
export async function startFeedCursor(executor: Executor, feedKey: string, occurrence: Date) {
  await executor
    .insert(feedCursors)
    .values({ feedKey, lastOccurrenceAt: occurrence })
    .onConflictDoNothing({ target: feedCursors.feedKey });
}

/** Moves the cursor to a processed collection time and clears the failed reads. */
export async function advanceFeedCursor(executor: Executor, feedKey: string, occurrence: Date) {
  await executor
    .update(feedCursors)
    .set({ lastOccurrenceAt: occurrence, failedAttempts: 0, retryAt: null })
    .where(eq(feedCursors.feedKey, feedKey));
}

export async function recordFeedReadFailure(
  executor: Executor,
  feedKey: string,
  failedAttempts: number,
  retryAt: Date,
) {
  await executor
    .update(feedCursors)
    .set({ failedAttempts, retryAt })
    .where(eq(feedCursors.feedKey, feedKey));
}
