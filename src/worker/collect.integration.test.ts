// The vexto-collect entry against a real PostgreSQL and the S3Mock bucket, with MSW serving the
// feed and a test double for speech synthesis: its exit code and log lines for a run with nothing
// to do, a run that publishes, a run that finds the lease taken and runs that fail.
import { randomUUID } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { articles } from '../features/articles/index.ts';
import { jobLeases } from '../features/collection/server/schema.ts';
import {
  articleHtml,
  feedServer,
  isolatedDatabase,
  makeFeedDue,
  resetCollectionTables,
  rssFeed,
  synthesizerDouble,
  testConfig,
  testDependencies,
  type IsolatedDatabase,
} from '../features/collection/testing.ts';
import { createDatabase } from '../lib/db/client.ts';
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
});

function messages() {
  return logged.map((entry) => entry.message);
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

  it('exits 1 when an article is due and this build cannot synthesize it', async () => {
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
    // Without a synthesizer and an eviction of its own, the run uses the production ones.
    const dependencies = testDependencies(db.database, { config });
    delete dependencies.loadSynthesizer;
    delete dependencies.storageRoom;

    expect(await main(dependencies)).toBe(1);

    expect(logged.at(-1)).toMatchObject({
      severity: 'ERROR',
      message: 'vexto-collect failed.',
      error: 'Audio storage eviction is not implemented.',
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
