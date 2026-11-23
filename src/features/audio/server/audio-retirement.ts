// Removing audio (.docs/design/data.md, 什么删掉什么): a row is first marked `retiring`, which
// takes it out of every lookup by cache key; its object is then deleted from the bucket, and once
// that succeeds the row goes too. A deletion that fails counts in retire_attempts and is tried
// again on the next pass. A retiring row keeps its byte_size until it is gone, so the storage cap
// counts its object until then.
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '../../../lib/db/client.ts';
import { errorFields, log } from '../../../lib/log.ts';
import type { ObjectStorage } from '../../../lib/storage/object-storage.ts';
import { audioAssets } from './schema.ts';

/**
 * Marks the pending rows created before `cutoff` as retiring: their synthesis never finished,
 * though it may have written the object. Returns how many there were.
 */
export async function retirePendingAudio(database: Database, cutoff: Date): Promise<number> {
  const retired = await database
    .update(audioAssets)
    .set({ state: 'retiring' })
    .where(and(eq(audioAssets.state, 'pending'), lt(audioAssets.createdAt, cutoff)))
    .returning({ id: audioAssets.id });
  return retired.length;
}

export type AudioDeletion = { deleted: number; failed: number };

/** Deletes the object and then the row of every retiring audio, oldest first. */
export async function deleteRetiringAudio(
  database: Database,
  storage: ObjectStorage,
): Promise<AudioDeletion> {
  const retiring = await database
    .select({ id: audioAssets.id, objectKey: audioAssets.objectKey })
    .from(audioAssets)
    .where(eq(audioAssets.state, 'retiring'))
    .orderBy(asc(audioAssets.createdAt), asc(audioAssets.id));
  const result: AudioDeletion = { deleted: 0, failed: 0 };
  for (const row of retiring) {
    try {
      await storage.deleteObject(row.objectKey);
    } catch (error) {
      await database
        .update(audioAssets)
        .set({ retireAttempts: sql`${audioAssets.retireAttempts} + 1` })
        .where(eq(audioAssets.id, row.id));
      log('WARNING', 'Deleting a retiring audio object failed.', {
        audioId: row.id,
        ...errorFields(error),
      });
      result.failed += 1;
      continue;
    }
    await database
      .delete(audioAssets)
      .where(and(eq(audioAssets.id, row.id), eq(audioAssets.state, 'retiring')));
    result.deleted += 1;
  }
  return result;
}
