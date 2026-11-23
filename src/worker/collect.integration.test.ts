// The vexto-collect entry against a real PostgreSQL and the S3Mock bucket, with MSW serving the
// feed and test doubles for the speech model: its exit code and log lines for a run with nothing
// to do, runs that publish, a run that finds the lease taken and runs that fail.
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { articleSentences, articles } from '../features/articles/index.ts';
import { audioAssets } from '../features/audio/index.ts';
import { createSpeechSynthesizer } from '../features/collection/server/speech-synthesizer.ts';
import { jobLeases } from '../features/collection/server/schema.ts';
import {
  articleHtml,
  feedServer,
  isolatedDatabase,
  makeFeedDue,
  resetCollectionTables,
  rssFeed,
  synthesizerDouble,
  testBucket,
  testConfig,
  testDependencies,
  type IsolatedDatabase,
} from '../features/collection/testing.ts';
import { readMp3 } from '../features/speech/index.ts';
import { mp3Encoder, toneEngine } from '../features/speech/testing.ts';
import { speechConfig } from '../lib/config/speech-config.ts';
import { createDatabase } from '../lib/db/client.ts';
import { createObjectStorage, storageSettingsFromEnv } from '../lib/storage/object-storage.ts';
import { main } from './collect.ts';

const FEED_URL = 'https://feeds.example.org/aeronautics.xml';
const config = testConfig({ 'nasa-aeronautics': { url: FEED_URL, body: 'feed', perRun: 2 } });

const feeds = feedServer();
let db: IsolatedDatabase;
let logged: Record<string, unknown>[];

beforeAll(async () => {
  feeds.listen();
  db = await isolatedDatabase();
}, 120_000);

afterAll(async () => {
  feeds.server.close();
  await db?.close();
});

beforeEach(async () => {
  await resetCollectionTables(db.database);
  logged = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    logged.push(JSON.parse(String(chunk)) as Record<string, unknown>);
    return true;
  });
});

afterEach(() => {
  feeds.server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function messages() {
  return logged.map((entry) => entry.message);
}

function serveFeed() {
  feeds.server.use(
    http.get(FEED_URL, () =>
      HttpResponse.text(
        rssFeed([
          {
            link: 'https://news.example.org/wing',
            title: 'A Quieter Wing',
            published: 'Thu, 05 Nov 2026 12:00:00 GMT',
            html: articleHtml('wing', 20),
          },
        ]),
      ),
    ),
  );
}

describe('vexto-collect', () => {
  it('exits 0 without loading the speech model when nothing is due', async () => {
    const synthesizer = synthesizerDouble();

    expect(
      await main(testDependencies(db.database, { config, loadSynthesizer: synthesizer.load })),
    ).toBe(0);

    expect(synthesizer.loads).toBe(0);
    expect(messages()[0]).toBe('vexto-collect started.');
    expect(logged.at(-1)).toMatchObject({
      severity: 'INFO',
      message: 'vexto-collect finished.',
      runId: expect.any(String),
      durationMs: expect.any(Number),
    });
  });

  it('collects a due feed, publishes its articles and exits 0', async () => {
    serveFeed();
    await makeFeedDue(db.database, 'nasa-aeronautics', config);
    const synthesizer = synthesizerDouble();

    expect(
      await main(testDependencies(db.database, { config, loadSynthesizer: synthesizer.load })),
    ).toBe(0);

    const published = await db.database.select().from(articles);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      title: 'A Quieter Wing',
      feedKey: 'nasa-aeronautics',
      categoryKey: 'science',
      state: 'ready',
    });
    expect(messages()).toEqual(
      expect.arrayContaining(['Article collected.', 'Article published.']),
    );
    expect(JSON.stringify(logged)).not.toContain('Survey wing counted');
  });

  it('publishes with the speech synthesizer and the production storage room', async () => {
    serveFeed();
    await makeFeedDue(db.database, 'nasa-aeronautics', config);
    const storage = createObjectStorage(storageSettingsFromEnv());
    const dependencies = testDependencies(db.database, {
      config,
      storage,
      loadSynthesizer: async () =>
        createSpeechSynthesizer({
          engine: toneEngine(),
          encoder: mp3Encoder(speechConfig.encoding.comment),
          storage,
          config: speechConfig,
        }),
    });
    delete dependencies.storageRoom;

    expect(await main(dependencies)).toBe(0);

    const [article] = await db.database.select().from(articles);
    expect(article.state).toBe('ready');
    const [audio] = await db.database
      .select()
      .from(audioAssets)
      .where(eq(audioAssets.id, article.audioAssetId!));
    expect(audio).toMatchObject({
      state: 'ready',
      voice: speechConfig.voice,
      modelRevision: speechConfig.modelRevision,
      encoding: speechConfig.encoding.version,
    });
    const stored = await testBucket().read(audio.objectKey);
    expect(stored.bytes.byteLength).toBe(audio.byteSize);
    expect(readMp3(stored.bytes).comment).toBe(speechConfig.encoding.comment);
    const sentences = await db.database
      .select()
      .from(articleSentences)
      .where(eq(articleSentences.articleId, article.id))
      .orderBy(asc(articleSentences.sentenceIndex));
    expect(sentences).toHaveLength(20);
    expect(sentences[0].startMs).toBe(0);
    expect(sentences[1].startMs).toBe(sentences[0].endMs! + speechConfig.sentenceGapMs);
    expect(sentences.at(-1)!.endMs).toBe(audio.durationMs);
  });

  it('exits 0 without work when another run holds the lease', async () => {
    await db.database
      .update(jobLeases)
      .set({ holder: randomUUID(), expiresAt: new Date(Date.now() + 600_000) });

    expect(await main(testDependencies(db.database, { config }))).toBe(0);

    expect(messages()).toEqual([
      'vexto-collect started.',
      'Another run holds the collection lease; this run leaves.',
      'vexto-collect finished.',
    ]);
  });

  it('exits 1 when an article is due and the speech model cannot be loaded', async () => {
    vi.stubEnv('MODEL_DIR', '');
    await db.database.insert(articles).values({
      feedKey: 'nasa-aeronautics',
      categoryKey: 'science',
      sourceUrl: 'https://news.example.org/due',
      title: 'Due',
      bodyText: 'Due now.',
      bodyHash: randomUUID(),
      state: 'preparing',
      retryAt: new Date(Date.now() - 60_000),
    });
    // Without a synthesizer and a storage room of its own, the run uses the production ones.
    const dependencies = testDependencies(db.database, { config });
    delete dependencies.loadSynthesizer;
    delete dependencies.storageRoom;

    expect(await main(dependencies)).toBe(1);

    expect(logged.at(-1)).toMatchObject({
      severity: 'ERROR',
      message: 'vexto-collect failed.',
      error: 'MODEL_DIR is not set; it must name the speech model directory.',
    });
    const [lease] = await db.database.select().from(jobLeases);
    expect(lease.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('exits 1 when the database cannot be reached', async () => {
    const unreachable = createDatabase('postgres://nobody:secret@127.0.0.1:9/none', { max: 1 });

    try {
      expect(await main({ database: unreachable.database, config })).toBe(1);
    } finally {
      await unreachable.client.end({ timeout: 1 });
    }

    expect(logged.at(-1)).toMatchObject({ severity: 'ERROR', message: 'vexto-collect failed.' });
    expect(JSON.stringify(logged)).not.toContain('secret');
  });
});
