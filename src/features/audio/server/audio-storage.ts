// What the storage cap reads and changes on the audio rows (.docs/design/rules.md, 朗读和存储上限).
// The stored size counts every row that still has an object: `ready` rows, and `retiring` rows
// until their object is gone. Eviction takes the oldest `ready` rows by created_at and id, and
// marks them `retiring`; deleteRetiringAudio then removes their objects and rows.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import { audioAssets } from './schema.ts';

/** Bytes the bucket holds for the audio rows. */
export async function storedAudioBytes(executor: Executor): Promise<number> {
  const [row] = await executor
    .select({ total: sql<string>`coalesce(sum(${audioAssets.byteSize}), 0)` })
    .from(audioAssets)
    .where(inArray(audioAssets.state, ['ready', 'retiring']));
  return Number(row.total);
}

export type StoredAudio = { id: string; byteSize: number };

/** The oldest ready audio rows, at most `limit`, oldest first. */
export async function oldestReadyAudio(executor: Executor, limit: number): Promise<StoredAudio[]> {
  const rows = await executor
    .select({ id: audioAssets.id, byteSize: audioAssets.byteSize })
    .from(audioAssets)
    .where(eq(audioAssets.state, 'ready'))
    .orderBy(asc(audioAssets.createdAt), asc(audioAssets.id))
    .limit(limit);
  return rows.map((row) => ({ id: row.id, byteSize: row.byteSize ?? 0 }));
}

/** Marks these ready rows retiring; returns the IDs that were still ready. */
export async function retireAudio(executor: Executor, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const retired = await executor
    .update(audioAssets)
    .set({ state: 'retiring' })
    .where(and(inArray(audioAssets.id, [...ids]), eq(audioAssets.state, 'ready')))
    .returning({ id: audioAssets.id });
  return retired.map((row) => row.id);
}
