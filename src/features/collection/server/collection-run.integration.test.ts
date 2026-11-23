// The collection pipeline against a real PostgreSQL and the S3Mock bucket, with MSW serving the
// feeds and pages and test doubles for speech synthesis and eviction. Each case starts from empty
// tables in a database of this file's own.
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../lib/db/client.ts';
import { articleSentences, articles } from '../../articles/index.ts';
import { audioAssets } from '../../audio/index.ts';
import { usageRecords } from '../../usage/index.ts';
import { nextUtcMonthStart, utcMonthOf } from '../domain/synthesis-plan.ts';
import { latestOccurrence } from '../domain/schedule.ts';
import {
  articleHtml,
  articlePage,
  failingStorage,
  feedServer,
  isolatedDatabase,
  makeFeedDue,
  resetCollectionTables,
  rssFeed,
  storageRoomDouble,
  synthesizerDouble,
  testBucket,
  testConfig,
  testDependencies,
  ttsFailure,
  type FeedEntryFixture,
  type IsolatedDatabase,
  type SynthesizerDouble,
} from '../testing.ts';
import type { CollectionDependencies } from './collection-run.ts';
import { runCollection } from './collection-run.ts';
import { feedCursors, jobLeases, seenItems, synthesisCpuMonths } from './schema.ts';

const FEED_URL = 'https://feeds.example.org/technology.xml';
const PAGE_FEED_URL = 'https://feeds.example.org/news.xml';
const MINUTE = 60_000;

const feeds = feedServer();
const requested: string[] = [];
let db: IsolatedDatabase;
let database: Database;
let synthesizer: SynthesizerDouble;

/** Whether a request goes to one of the made-up example.org hosts rather than to the bucket. */
function toTestHost(url: string) {
  const { hostname } = new URL(url);
  return hostname === 'example.org' || hostname.endsWith('.example.org');
}

beforeAll(async () => {
  feeds.listen();
  feeds.server.events.on('request:start', ({ request }) => {
    if (toTestHost(request.url)) {
      requested.push(request.url);
    }
  });
  db = await isolatedDatabase();
  database = db.database;
}, 120_000);

afterAll(async () => {
  feeds.server.close();
  await db?.close();
});

beforeEach(async () => {
  await resetCollectionTables(database);
  feeds.server.resetHandlers();
  requested.length = 0;
  synthesizer = synthesizerDouble();
  vi.restoreAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

const feedConfig = testConfig({ 'nasa-technology': { url: FEED_URL, body: 'feed', perRun: 2 } });

/** A clock that moves one second on every reading, so each synthesis takes a few seconds. */
function steppingClock() {
  let now = 0;
  return () => (now += 1000);
}

function run(overrides: Partial<CollectionDependencies> = {}) {
  return runCollection(
    testDependencies(database, {
      config: feedConfig,
      loadSynthesizer: synthesizer.load,
      monotonicMs: steppingClock(),
      ...overrides,
    }),
  );
}

function serveFeed(url: string, entries: FeedEntryFixture[]) {
  feeds.server.use(
    http.get(url, () =>
      HttpResponse.text(rssFeed(entries), {
        headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
      }),
    ),
  );
}

function entry(name: string, published?: string, html = articleHtml(name, 20)): FeedEntryFixture {
  return { link: `https://news.example.org/${name}`, title: `Story ${name}`, published, html };
}

function articleRows() {
  return database.select().from(articles).orderBy(asc(articles.createdAt), asc(articles.title));
}

async function cursorOf(feedKey: string) {
  const [cursor] = await database
    .select()
    .from(feedCursors)
    .where(eq(feedCursors.feedKey, feedKey));
  return cursor;
}

async function seenCount() {
  const [row] = await database.select({ count: sql<number>`count(*)::int` }).from(seenItems);
  return row.count;
}

function near(time: Date | null, expected: number) {
  expect(time).not.toBeNull();
  expect(Math.abs((time?.getTime() ?? 0) - expected)).toBeLessThan(MINUTE);
}

/** A preparing article written straight into the table, with one sentence. */
async function preparingArticle(values: Partial<typeof articles.$inferInsert> = {}) {
  const id = randomUUID();
  await database.insert(articles).values({
    id,
    feedKey: 'nasa-technology',
    categoryKey: 'technology',
    sourceUrl: `https://news.example.org/${id}`,
    title: 'Waiting',
    bodyText: 'It waits.',
    bodyHash: id,
    state: 'preparing',
    retryAt: new Date(Date.now() - MINUTE),
    ...values,
  });
  await database.insert(articleSentences).values({
    articleId: id,
    sentenceIndex: 0,
    paragraphIndex: 0,
    text: 'It waits.',
    bodyStart: 0,
    bodyEnd: 9,
  });
  return id;
}

async function articleById(id: string) {
  const [article] = await database.select().from(articles).where(eq(articles.id, id));
  return article;
}

describe('scheduling', () => {
  it('starts a new feed at its latest collection time without fetching anything', async () => {
    await run();

    const cursor = await cursorOf('nasa-technology');
    expect(cursor.lastOccurrenceAt).toEqual(
      latestOccurrence(feedConfig.feeds['nasa-technology'], new Date()),
    );
    expect(cursor.failedAttempts).toBe(0);
    expect(await cursorOf('nist-news')).toBeUndefined();
    expect(requested).toEqual([]);
    expect(synthesizer.loads).toBe(0);
  });

  it('does nothing for a feed whose next collection time has not come', async () => {
    await run();
    await run();

    expect(requested).toEqual([]);
    expect(await articleRows()).toEqual([]);
  });

  it('processes up to four missed collection times, each taking its own entries', async () => {
    const config = testConfig({ 'nasa-technology': { url: FEED_URL, body: 'feed', perRun: 1 } });
    serveFeed(
      FEED_URL,
      ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) =>
        entry(name, `Thu, 0${index + 1} Oct 2026 12:00:00 GMT`),
      ),
    );
    await makeFeedDue(database, 'nasa-technology', config, 6);

    await run({ config });

    expect((await articleRows()).map((article) => article.title).sort()).toEqual([
      'Story c',
      'Story d',
      'Story e',
      'Story f',
    ]);
    expect(requested).toEqual([FEED_URL]);
    expect((await cursorOf('nasa-technology')).lastOccurrenceAt).toEqual(
      latestOccurrence(config.feeds['nasa-technology'], new Date()),
    );
  });
});

describe('collecting and publishing', () => {
  it('publishes the newest two new entries with their audio, timeline and usage', async () => {
    serveFeed(FEED_URL, [
      entry('older', 'Mon, 02 Nov 2026 12:00:00 GMT'),
      entry('newest', 'Wed, 04 Nov 2026 12:00:00 GMT'),
      entry('middle', '2026-11-03T12:00:00Z'),
    ]);
    await makeFeedDue(database, 'nasa-technology', feedConfig);
    const storageRoom = storageRoomDouble();

    await run({ storageRoom });

    const published = await articleRows();
    expect(published.map((article) => article.title).sort()).toEqual([
      'Story middle',
      'Story newest',
    ]);
    for (const article of published) {
      expect(article).toMatchObject({
        feedKey: 'nasa-technology',
        categoryKey: 'technology',
        state: 'ready',
        attempts: 1,
        retryAt: null,
        lastErrorCode: null,
      });
      near(article.collectedAt, Date.now());
      expect(article.bodyText.split('\n\n')).toHaveLength(4);
      const [audio] = await database
        .select()
        .from(audioAssets)
        .where(eq(audioAssets.id, article.audioAssetId ?? ''));
      expect(audio).toMatchObject({
        state: 'ready',
        byteSize: 80_000,
        durationMs: 20_000,
        voice: 'F1',
        modelRevision: 'test-revision',
        encoding: 'mp3-mono-32k-test',
        objectKey: `articles/${audio.id}.mp3`,
      });
      const sentences = await database
        .select()
        .from(articleSentences)
        .where(eq(articleSentences.articleId, article.id))
        .orderBy(asc(articleSentences.sentenceIndex));
      expect(sentences).toHaveLength(20);
      expect(sentences[1]).toMatchObject({ paragraphIndex: 0, startMs: 1000, endMs: 1900 });
      expect(sentences[19]).toMatchObject({ paragraphIndex: 3, startMs: 19000, endMs: 19900 });
      expect(article.bodyText.slice(sentences[5].bodyStart, sentences[5].bodyEnd)).toBe(
        sentences[5].text,
      );
    }
    expect(storageRoom.articles).toEqual(
      expect.arrayContaining([expect.objectContaining({ wordCount: 200, sentenceCount: 20 })]),
    );
    expect(synthesizer.loads).toBe(1);
    expect(synthesizer.requests).toHaveLength(2);

    const usage = await database.select().from(usageRecords);
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      kind: 'article_tts',
      provider: 'test-speech',
      model: 'test-voice-model',
      engineRevision: 'test-revision',
      status: 'succeeded',
      audioMs: 20_000,
      cpuMs: 25,
      byteCount: 80_000,
      resourceType: 'article',
      ownerId: null,
    });
    const [month] = await database.select().from(synthesisCpuMonths);
    expect(month.month).toBe(utcMonthOf(new Date()));
    expect(month.synthesisSeconds).toBeGreaterThan(0);
    expect(await seenCount()).toBe(2);
    expect((await cursorOf('nasa-technology')).lastOccurrenceAt).toEqual(
      latestOccurrence(feedConfig.feeds['nasa-technology'], new Date()),
    );
  });

  it('counts an entry without a readable time as first seen now, ahead of dated ones', async () => {
    serveFeed(FEED_URL, [
      entry('dated', 'Wed, 04 Nov 2026 12:00:00 GMT'),
      entry('undated', '11/05/2026 - 12:00'),
      entry('two-digit-year', 'Thu, 05 Nov 26 12:00:00 GMT'),
    ]);
    await makeFeedDue(database, 'nasa-technology', feedConfig);

    await run();

    expect((await articleRows()).map((article) => article.title).sort()).toEqual([
      'Story two-digit-year',
      'Story undated',
    ]);
  });

  it('takes only the newest new entries and does not fill skipped places with older ones', async () => {
    serveFeed(FEED_URL, [
      entry('seen', 'Thu, 05 Nov 2026 12:00:00 GMT'),
      entry('short', 'Wed, 04 Nov 2026 12:00:00 GMT', articleHtml('short', 10)),
      entry('kept', 'Tue, 03 Nov 2026 12:00:00 GMT'),
      entry('older', 'Mon, 02 Nov 2026 12:00:00 GMT'),
    ]);
    await run();
    await makeFeedDue(database, 'nasa-technology', feedConfig);
    serveFeed(FEED_URL, [entry('seen', 'Thu, 05 Nov 2026 12:00:00 GMT')]);
    await run();
    await makeFeedDue(database, 'nasa-technology', feedConfig);
    serveFeed(FEED_URL, [
      entry('seen', 'Thu, 05 Nov 2026 12:00:00 GMT'),
      entry('short', 'Wed, 04 Nov 2026 12:00:00 GMT', articleHtml('short', 10)),
      entry('kept', 'Tue, 03 Nov 2026 12:00:00 GMT'),
      entry('older', 'Mon, 02 Nov 2026 12:00:00 GMT'),
    ]);

    await run();

    expect((await articleRows()).map((article) => article.title)).toEqual([
      'Story seen',
      'Story kept',
    ]);
    expect(await seenCount()).toBe(3);
  });

  it('skips and remembers entries out of the word limits, without a body or with a known body', async () => {
    const config = testConfig({ 'nasa-technology': { url: FEED_URL, body: 'feed', perRun: 5 } });
    serveFeed(FEED_URL, [
      entry('good', 'Thu, 05 Nov 2026 12:00:00 GMT'),
      { ...entry('copy', 'Wed, 04 Nov 2026 12:00:00 GMT'), html: articleHtml('good', 20) },
      entry('short', 'Tue, 03 Nov 2026 12:00:00 GMT', articleHtml('short', 14)),
      entry('long', 'Mon, 02 Nov 2026 12:00:00 GMT', articleHtml('long', 101)),
      { link: 'https://news.example.org/empty', title: 'Empty', published: '2026-11-01T00:00:00Z' },
    ]);
    await makeFeedDue(database, 'nasa-technology', config);

    await run({ config });

    expect((await articleRows()).map((article) => article.title)).toEqual(['Story good']);
    expect(await seenCount()).toBe(5);

    await makeFeedDue(database, 'nasa-technology', config);
    await run({ config });

    expect(await articleRows()).toHaveLength(1);
    expect(requested).toEqual([FEED_URL, FEED_URL]);
  });

  it('collects an article at either word limit', async () => {
    const config = testConfig({ 'nasa-technology': { url: FEED_URL, body: 'feed', perRun: 2 } });
    serveFeed(FEED_URL, [
      entry('fewest', 'Thu, 05 Nov 2026 12:00:00 GMT', articleHtml('fewest', 15)),
      entry('most', 'Wed, 04 Nov 2026 12:00:00 GMT', articleHtml('most', 100)),
    ]);
    await makeFeedDue(database, 'nasa-technology', config);

    await run({ config });

    expect(await articleRows()).toHaveLength(2);
  });

  describe('from original pages', () => {
    const pageConfig = testConfig({
      'nist-news': { url: PAGE_FEED_URL, body: 'page', perRun: 5 },
    });

    function page(name: string) {
      return http.get(`https://news.example.org/${name}`, () =>
        HttpResponse.html(articlePage(`Story ${name}`, articleHtml(name, 20))),
      );
    }

    it('extracts the article of each page and skips pages that fail for good', async () => {
      serveFeed(
        PAGE_FEED_URL,
        ['good', 'gone', 'busy', 'insecure', 'blank'].map((name, index) => ({
          ...entry(name, `Thu, 0${5 - index} Nov 2026 12:00:00 GMT`),
          html: undefined,
          link:
            name === 'insecure'
              ? 'http://news.example.org/insecure'
              : `https://news.example.org/${name}`,
        })),
      );
      feeds.server.use(
        page('good'),
        http.get('https://news.example.org/gone', () => new HttpResponse(null, { status: 404 })),
        http.get('https://news.example.org/busy', () => new HttpResponse(null, { status: 503 })),
        http.get('https://news.example.org/blank', () =>
          HttpResponse.html('<html><body></body></html>'),
        ),
      );
      await makeFeedDue(database, 'nist-news', pageConfig);

      await run({ config: pageConfig });

      const [article] = await articleRows();
      expect(article).toMatchObject({ title: 'Story good', state: 'ready' });
      expect(article.bodyText).not.toContain('Footer text');
      expect(article.bodyText.startsWith('Survey good counted 1 birds')).toBe(true);
      expect(await seenCount()).toBe(4);

      feeds.server.use(page('busy'));
      await makeFeedDue(database, 'nist-news', pageConfig);
      await run({ config: pageConfig });

      expect((await articleRows()).map((row) => row.title)).toEqual(['Story good', 'Story busy']);
      expect(requested.filter((url) => url.endsWith('/gone'))).toHaveLength(1);
      expect(requested.filter((url) => url.endsWith('/busy'))).toHaveLength(2);
    });
  });
});

describe('reading a feed that fails', () => {
  it.each([
    ['answers 503', () => new HttpResponse(null, { status: 503 })],
    ['answers with a page that is not a feed', () => HttpResponse.html('<p>Maintenance</p>')],
    ['cannot be reached', () => HttpResponse.error()],
  ])('keeps the cursor and waits when the feed %s', async (_name, answer) => {
    feeds.server.use(http.get(FEED_URL, answer));
    await makeFeedDue(database, 'nasa-technology', feedConfig);
    const before = await cursorOf('nasa-technology');

    await run();

    const after = await cursorOf('nasa-technology');
    expect(after.lastOccurrenceAt).toEqual(before.lastOccurrenceAt);
    expect(after.failedAttempts).toBe(1);
    near(after.retryAt, Date.now() + 15 * MINUTE);

    await run();
    expect(requested).toEqual([FEED_URL]);
  });

  it('waits longer after each failure and gives the collection time up at the fifth', async () => {
    feeds.server.use(http.get(FEED_URL, () => new HttpResponse(null, { status: 500 })));
    await makeFeedDue(database, 'nasa-technology', feedConfig);
    const due = latestOccurrence(feedConfig.feeds['nasa-technology'], new Date());

    for (const [failures, wait] of [
      [1, 15],
      [2, 30],
      [3, 60],
      [4, 120],
    ]) {
      await run();
      const cursor = await cursorOf('nasa-technology');
      expect(cursor.failedAttempts).toBe(failures);
      near(cursor.retryAt, Date.now() + wait * MINUTE);
      await database.update(feedCursors).set({ retryAt: new Date(Date.now() - MINUTE) });
    }
    await run();

    const cursor = await cursorOf('nasa-technology');
    expect(cursor).toMatchObject({ lastOccurrenceAt: due, failedAttempts: 0, retryAt: null });
    expect(requested).toHaveLength(5);
  });
});

describe('synthesis that fails', () => {
  it('retries with growing waits and fails the article after its fifth attempt', async () => {
    synthesizer.failWith(ttsFailure());
    serveFeed(FEED_URL, [entry('fragile', 'Thu, 05 Nov 2026 12:00:00 GMT')]);
    await makeFeedDue(database, 'nasa-technology', feedConfig);

    await run();
    const [first] = await articleRows();
    expect(first).toMatchObject({ state: 'preparing', attempts: 1, lastErrorCode: 'tts_error' });
    near(first.retryAt, Date.now() + 15 * MINUTE);

    await run();
    expect(synthesizer.requests).toHaveLength(1);

    for (const [attempt, wait] of [
      [2, 30],
      [3, 60],
      [4, 120],
    ]) {
      await database.update(articles).set({ retryAt: new Date(Date.now() - MINUTE) });
      await run();
      const article = await articleById(first.id);
      expect(article).toMatchObject({ state: 'preparing', attempts: attempt });
      near(article.retryAt, Date.now() + wait * MINUTE);
    }
    await database.update(articles).set({ retryAt: new Date(Date.now() - MINUTE) });
    await run();

    expect(await articleById(first.id)).toMatchObject({
      state: 'failed',
      attempts: 5,
      retryAt: null,
      lastErrorCode: 'tts_error',
      audioAssetId: null,
    });
    expect(synthesizer.requests).toHaveLength(5);
    const usage = await database.select().from(usageRecords);
    expect(usage).toHaveLength(5);
    expect(
      usage.every((record) => record.status === 'failed' && record.errorCode === 'tts_error'),
    ).toBe(true);
    const [month] = await database.select().from(synthesisCpuMonths);
    expect(month.synthesisSeconds).toBeGreaterThan(0);
  });

  it('retries the whole article with the same audio row and object key', async () => {
    synthesizer.failWith(ttsFailure());
    const id = await preparingArticle();

    await run();
    synthesizer.failWith(null);
    await database.update(articles).set({ retryAt: new Date(Date.now() - MINUTE) });
    await run();

    const [firstKey, secondKey] = synthesizer.requests.map((request) => request.objectKey);
    expect(secondKey).toBe(firstKey);
    expect(synthesizer.requests[1].sentences).toEqual(['It waits.']);
    expect(await articleById(id)).toMatchObject({
      state: 'ready',
      attempts: 2,
      lastErrorCode: null,
    });
    expect(await database.select().from(audioAssets)).toHaveLength(1);
  });

  it('rejects audio whose timeline does not fit the sentences, as a synthesis failure', async () => {
    const id = await preparingArticle();
    const broken = synthesizerDouble();
    const loaded = await broken.load();
    const misfit = {
      ...loaded,
      synthesize: async () => ({
        byteSize: 10,
        durationMs: 500,
        cpuMs: 1,
        sentenceTimings: [{ startMs: 0, endMs: 900 }],
      }),
    };

    await run({ loadSynthesizer: async () => misfit });

    expect(await articleById(id)).toMatchObject({
      state: 'preparing',
      attempts: 1,
      lastErrorCode: 'tts_error',
    });
  });

  it('fails an article whose last attempt stopped in the middle', async () => {
    const id = await preparingArticle({ attempts: 5, lastErrorCode: 'interrupted' });

    await run();

    expect(await articleById(id)).toMatchObject({
      state: 'failed',
      attempts: 5,
      retryAt: null,
      lastErrorCode: 'interrupted',
    });
    expect(synthesizer.loads).toBe(0);
  });

  it('ends the run on an unexpected error, with the attempt counted as interrupted', async () => {
    const id = await preparingArticle();
    synthesizer.failWith(new Error('The model file is missing.'));

    await expect(run()).rejects.toThrow('The model file is missing.');

    const article = await articleById(id);
    expect(article).toMatchObject({
      state: 'preparing',
      attempts: 1,
      lastErrorCode: 'interrupted',
    });
    near(article.retryAt, Date.now() + 15 * MINUTE);
    const [lease] = await database.select().from(jobLeases);
    expect(lease.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('the synthesis budget and window', () => {
  it('defers synthesis to the next UTC month once the budget is spent, without an attempt', async () => {
    // 96000 seconds on 2 vCPUs is the 192000 vCPU-second budget.
    await database
      .insert(synthesisCpuMonths)
      .values({ month: utcMonthOf(new Date()), synthesisSeconds: 96000 });
    serveFeed(FEED_URL, [entry('later', 'Thu, 05 Nov 2026 12:00:00 GMT')]);
    await makeFeedDue(database, 'nasa-technology', feedConfig);

    await run();

    const [article] = await articleRows();
    expect(article).toMatchObject({ state: 'preparing', attempts: 0 });
    expect(article.retryAt).toEqual(nextUtcMonthStart(new Date()));
    expect(synthesizer.loads).toBe(0);
    expect(await seenCount()).toBe(1);
  });

  it('synthesizes while the month is below the budget', async () => {
    await database
      .insert(synthesisCpuMonths)
      .values({ month: utcMonthOf(new Date()), synthesisSeconds: 95999.9 });
    const id = await preparingArticle();

    await run();

    expect(await articleById(id)).toMatchObject({ state: 'ready' });
  });

  it('leaves articles for the next run once the synthesis window has passed', async () => {
    serveFeed(FEED_URL, [entry('late', 'Thu, 05 Nov 2026 12:00:00 GMT')]);
    await makeFeedDue(database, 'nasa-technology', feedConfig);

    await run({ synthesisWindowMs: 0 });

    const [article] = await articleRows();
    expect(article).toMatchObject({ state: 'preparing', attempts: 0 });
    near(article.retryAt, Date.now());
    expect(synthesizer.loads).toBe(0);

    await run();
    expect(await articleById(article.id)).toMatchObject({ state: 'ready' });
  });
});

describe('the lease', () => {
  it('leaves without any work while another run holds the lease', async () => {
    const other = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * MINUTE);
    await database.update(jobLeases).set({ holder: other, expiresAt });
    await preparingArticle();

    const summary = await run();

    expect(summary.leased).toBe(false);
    expect(await database.select().from(feedCursors)).toEqual([]);
    expect(synthesizer.loads).toBe(0);
    expect(await database.select().from(jobLeases)).toEqual([
      { name: 'collect', holder: other, expiresAt },
    ]);
  });

  it('holds the lease while it runs and gives it back at the end', async () => {
    let leaseDuringRun: { holder: string | null; expiresAt: Date } | undefined;
    const storageRoom = {
      async makeRoomFor() {
        [leaseDuringRun] = await database.select().from(jobLeases);
      },
    };
    await preparingArticle();

    const summary = await run({ storageRoom });

    expect(leaseDuringRun?.holder).toBe(summary.runId);
    near(leaseDuringRun?.expiresAt ?? null, Date.now() + 70 * MINUTE);
    const [lease] = await database.select().from(jobLeases);
    expect(lease.holder).toBe(summary.runId);
    expect(lease.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await run()).leased).toBe(true);
  });
});

describe('removing expired rows', () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

  it('removes failed articles, receipts, seen entries and stale pending audio past their time', async () => {
    const oldFailed = await preparingArticle({
      state: 'failed',
      retryAt: null,
      createdAt: daysAgo(31),
    });
    const newFailed = await preparingArticle({
      state: 'failed',
      retryAt: null,
      createdAt: daysAgo(29),
    });
    await database.insert(seenItems).values([
      { urlHash: 'old', firstSeenAt: daysAgo(181) },
      { urlHash: 'recent', firstSeenAt: daysAgo(179) },
    ]);
    const [member] = await database.execute<{ id: string }>(
      sql`insert into members (email, status, created_at) values (${`${randomUUID()}@example.org`}, 'active', now()) returning id`,
    );
    await database.execute(sql`
      insert into operation_receipts (owner_id, operation_id, kind, request_digest, response_status, created_at)
      values (${member.id}, ${randomUUID()}, 'lookup.create', 'd', 201, now() - interval '25 hours'),
             (${member.id}, ${randomUUID()}, 'lookup.create', 'd', 201, now() - interval '23 hours')`);
    const bucket = testBucket();
    const staleKey = `articles/${randomUUID()}.mp3`;
    await bucket.put(staleKey);
    await database
      .insert(audioAssets)
      .values([
        audioRow('stale', staleKey, 'pending', new Date(Date.now() - 61 * MINUTE)),
        audioRow(
          'fresh',
          `articles/${randomUUID()}.mp3`,
          'pending',
          new Date(Date.now() - 30 * MINUTE),
        ),
      ]);

    await run();

    expect(await articleById(oldFailed)).toBeUndefined();
    expect(await articleById(newFailed)).toBeDefined();
    expect(
      await database
        .select()
        .from(articleSentences)
        .where(eq(articleSentences.articleId, oldFailed)),
    ).toEqual([]);
    expect((await database.select().from(seenItems)).map((row) => row.urlHash)).toEqual(['recent']);
    const receipts = await database.execute(sql`select 1 from operation_receipts`);
    expect(receipts).toHaveLength(1);
    expect((await database.select().from(audioAssets)).map((row) => row.cacheKey)).toEqual([
      'fresh',
    ]);
    expect(await bucket.has(staleKey)).toBe(false);
  });

  it('keeps a retiring row whose object could not be deleted and counts the attempt', async () => {
    await database
      .insert(audioAssets)
      .values(audioRow('stuck', `speech/${randomUUID()}.mp3`, 'retiring', new Date()));

    await run({ storage: failingStorage });
    await run({ storage: failingStorage });

    const [row] = await database.select().from(audioAssets);
    expect(row).toMatchObject({ cacheKey: 'stuck', state: 'retiring', retireAttempts: 2 });
  });
});

function audioRow(
  cacheKey: string,
  objectKey: string,
  state: 'pending' | 'retiring',
  createdAt: Date,
) {
  return {
    cacheKey,
    objectKey,
    state,
    voice: 'F1',
    modelRevision: 'test-revision',
    encoding: 'mp3-mono-32k-test',
    createdAt,
  };
}
