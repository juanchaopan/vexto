// The rows each run removes at its end (.docs/design/rules.md, 保留期限): failed articles 30 days
// after they were written, with their sentences; operation receipts after 24 hours; seen entries
// 180 days after they were first seen; pending audio rows an hour after they were made, through
// the same retiring steps as evicted audio, since their object may have been written. The objects
// of retiring rows that are left from earlier runs are deleted as well.
import { and, eq, lt } from 'drizzle-orm';
import { deleteExpiredOperationReceipts } from '../../../lib/db/operation-receipts.ts';
import { log } from '../../../lib/log.ts';
import { articles } from '../../articles/index.ts';
import { deleteRetiringAudio, retirePendingAudio } from '../../audio/index.ts';
import { RETENTION } from '../domain/collection-state.ts';
import { addMinutes } from '../domain/retry.ts';
import type { CollectionRun } from './run-context.ts';
import { seenItems } from './schema.ts';

const DAY_MINUTES = 24 * 60;

async function deleteFailedArticles(run: CollectionRun, cutoff: Date) {
  const deleted = await run.database
    .delete(articles)
    .where(and(eq(articles.state, 'failed'), lt(articles.createdAt, cutoff)))
    .returning({ id: articles.id });
  return deleted.length;
}

async function deleteSeenItems(run: CollectionRun, cutoff: Date) {
  const deleted = await run.database
    .delete(seenItems)
    .where(lt(seenItems.firstSeenAt, cutoff))
    .returning({ urlHash: seenItems.urlHash });
  return deleted.length;
}

export type RetentionResult = {
  failedArticles: number;
  operationReceipts: number;
  seenItems: number;
  pendingAudio: number;
  deletedAudio: number;
  audioDeleteFailures: number;
};

export async function removeExpiredRows(run: CollectionRun): Promise<RetentionResult> {
  const now = run.now();
  const failedArticles = await deleteFailedArticles(
    run,
    addMinutes(now, -RETENTION.failedArticleDays * DAY_MINUTES),
  );
  const operationReceipts = await deleteExpiredOperationReceipts(run.database);
  const seen = await deleteSeenItems(run, addMinutes(now, -RETENTION.seenItemDays * DAY_MINUTES));
  const pendingAudio = await retirePendingAudio(
    run.database,
    addMinutes(now, -RETENTION.pendingAudioMinutes),
  );
  const audio = await deleteRetiringAudio(run.database, run.storage);
  const result: RetentionResult = {
    failedArticles,
    operationReceipts,
    seenItems: seen,
    pendingAudio,
    deletedAudio: audio.deleted,
    audioDeleteFailures: audio.failed,
  };
  log('INFO', 'Expired rows removed.', { runId: run.runId, ...result });
  return result;
}
