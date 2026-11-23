// The storage cap against a real PostgreSQL and the S3Mock bucket: which audio goes, what goes
// with an article's audio, and what a bucket that refuses deletions changes. The cap is scaled
// down so a few rows fill it; each case starts from empty tables in a database of its own.
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectionConfig } from '../../../lib/config/collection-config.ts';
import { speechConfig } from '../../../lib/config/speech-config.ts';
import type { Database } from '../../../lib/db/client.ts';
import {
  createObjectStorage,
  storageSettingsFromEnv,
} from '../../../lib/storage/object-storage.ts';
import type { ObjectStorage } from '../../../lib/storage/object-storage.ts';
import { articleSentences, articles, visits } from '../../articles/index.ts';
import { audioAssets, type AudioState } from '../../audio/index.ts';
import {
  failingStorage,
  isolatedDatabase,
  resetCollectionTables,
  testBucket,
  type IsolatedDatabase,
} from '../testing.ts';
import { createAudioStorageRoom } from './storage-room.ts';

let db: IsolatedDatabase;
let database: Database;
const bucket = () => testBucket();

beforeAll(async () => {
  db = await isolatedDatabase();
  database = db.database;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await resetCollectionTables(database);
  vi.restoreAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

/** A cap of 100 000 bytes; eviction starts at 95 000 and goes below 90 000, one row a batch. */
const config = {
  ...collectionConfig,
  storage: { capBytes: 100_000, evictAtRatio: 0.95, evictToRatio: 0.9, evictBatchSize: 1 },
};

/** 15 words in one sentence: 6 s at 150 words a minute, 24 000 bytes at 32 kbps. */
const smallArticle = { articleId: randomUUID(), wordCount: 15, sentenceCount: 1 };

function room(storage: ObjectStorage = createObjectStorage(storageSettingsFromEnv())) {
  return createAudioStorageRoom({ database, storage, config, speech: speechConfig });
}

type StoredRow = { id: string; objectKey: string };

/** An audio row of this size made `minutesAgo` ago, with its object in the bucket. */
async function audio(
  byteSize: number,
  minutesAgo: number,
  kind: 'speech' | 'articles' = 'speech',
  state: AudioState = 'ready',
): Promise<StoredRow> {
  const id = randomUUID();
  const objectKey = `${kind}/${id}.mp3`;
  await bucket().put(objectKey);
  await database.insert(audioAssets).values({
    id,
    cacheKey: randomUUID(),
    objectKey,
    state,
    byteSize,
    durationMs: 1000,
    voice: 'F1',
    modelRevision: 'test-revision',
    encoding: 'mp3-mono-32k-test',
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
  });
  return { id, objectKey };
}

/** A ready article whose audio is this row, with a sentence and a member's visit. */
async function articleWith(audioRow: StoredRow) {
  const id = randomUUID();
  await database.insert(articles).values({
    id,
    feedKey: 'nasa-technology',
    categoryKey: 'technology',
    sourceUrl: `https://news.example.org/${id}`,
    title: 'Stored',
    bodyText: 'One sentence.',
    bodyHash: randomUUID(),
    state: 'ready',
    audioAssetId: audioRow.id,
    collectedAt: new Date(),
  });
  await database.insert(articleSentences).values({
    articleId: id,
    sentenceIndex: 0,
    paragraphIndex: 0,
    text: 'One sentence.',
    bodyStart: 0,
    bodyEnd: 13,
  });
  const [member] = await database.execute<{ id: string }>(
    sql`insert into members (email, status) values (${`${randomUUID()}@example.org`}, 'active') returning id`,
  );
  await database
    .insert(visits)
    .values({ ownerId: member.id, articleId: id, lastOpenedAt: new Date() });
  return id;
}

async function rows() {
  return database
    .select({
      id: audioAssets.id,
      state: audioAssets.state,
      retireAttempts: audioAssets.retireAttempts,
    })
    .from(audioAssets)
    .orderBy(asc(audioAssets.createdAt));
}

describe('the audio storage room', () => {
  it('leaves everything while the stored audio and the article stay under the eviction ratio', async () => {
    await audio(35_000, 30);
    await audio(35_000, 20);

    await room().makeRoomFor(smallArticle);

    expect((await rows()).map((row) => row.state)).toEqual(['ready', 'ready']);
  });

  it('evicts the oldest audio until the stored audio and the article fall below 90 %', async () => {
    const oldest = await audio(20_000, 50, 'articles');
    const second = await audio(20_000, 40);
    const kept = [await audio(20_000, 30), await audio(20_000, 20), await audio(20_000, 10)];
    const oldestArticle = await articleWith(oldest);
    const keptArticle = await articleWith(kept[0]);

    await room().makeRoomFor(smallArticle);

    // 100 000 stored and 24 000 coming is 34 000 over the target: two rows of 20 000 go.
    expect((await rows()).map((row) => row.id)).toEqual(kept.map((row) => row.id));
    expect(await bucket().has(oldest.objectKey)).toBe(false);
    expect(await bucket().has(second.objectKey)).toBe(false);
    expect(await bucket().has(kept[0].objectKey)).toBe(true);
    expect(await database.select().from(articles).where(eq(articles.id, oldestArticle))).toEqual(
      [],
    );
    expect(
      await database
        .select()
        .from(articleSentences)
        .where(eq(articleSentences.articleId, oldestArticle)),
    ).toEqual([]);
    expect(await database.select().from(visits).where(eq(visits.articleId, oldestArticle))).toEqual(
      [],
    );
    expect(await database.select().from(articles).where(eq(articles.id, keptArticle))).toHaveLength(
      1,
    );
  });

  it('starts when the article alone would pass the eviction ratio', async () => {
    await audio(40_000, 30);
    await audio(40_000, 20);

    await room().makeRoomFor({ articleId: randomUUID(), wordCount: 30, sentenceCount: 2 });

    // 80 000 stored and 48 000 + 1200 coming passes 95 000; one row of 40 000 is enough.
    expect((await rows()).map((row) => row.state)).toEqual(['ready']);
  });

  it('counts retiring audio until its object is gone, and never evicts pending audio', async () => {
    const pending = await audio(1, 60, 'speech', 'pending');
    await database
      .update(audioAssets)
      .set({ byteSize: null, durationMs: null })
      .where(eq(audioAssets.id, pending.id));
    await audio(60_000, 50, 'speech', 'retiring');
    const ready = await audio(30_000, 40);

    await room().makeRoomFor(smallArticle);

    const states = await rows();
    expect(states.find((row) => row.id === pending.id)?.state).toBe('pending');
    expect(states.find((row) => row.id === ready.id)).toBeUndefined();
  });

  it('evicts only what the target needs when the bucket refuses to delete', async () => {
    await audio(20_000, 50);
    await audio(20_000, 40);
    await audio(20_000, 30);
    await audio(20_000, 20);
    await audio(20_000, 10);

    await room(failingStorage).makeRoomFor(smallArticle);

    expect((await rows()).map((row) => [row.state, row.retireAttempts])).toEqual([
      ['retiring', 1],
      ['retiring', 1],
      ['ready', 0],
      ['ready', 0],
      ['ready', 0],
    ]);
  });
});
