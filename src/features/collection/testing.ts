// Test kit for the collection job's integration and security tests. Only test files import it.
//
// - isolatedDatabase(): a database of its own, built with the migration scripts in the test
//   PostgreSQL. A run of the job takes the one lease row and changes rows of every feed, so each
//   test file that runs it works in its own database, apart from the files running beside it.
// - feedServer(): MSW in front of the network. Feeds and pages are answered by the handlers a test
//   adds; the S3Mock bucket is passed through; anything else fails the request.
// - testResolver(): host names resolve to a public test address, or to the addresses a test gives.
// - synthesizerDouble() and storageRoomDouble(): stand-ins for speech synthesis and eviction.
// - Builders for feed documents and article text, all of it made up for the tests.
import { randomUUID } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import { setupServer } from 'msw/node';
import postgres from 'postgres';
import { migrateTestDatabase } from '../../../scripts/lib/test-services.ts';
import {
  collectionConfig,
  type CollectionConfig,
  type FeedCollection,
} from '../../lib/config/collection-config.ts';
import { createDatabase, type Database } from '../../lib/db/client.ts';
import {
  createObjectStorage,
  storageSettingsFromEnv,
  type ObjectStorage,
} from '../../lib/storage/object-storage.ts';
import { COLLECT_LEASE_NAME } from './domain/collection-state.ts';
import { occurrencesBetween } from './domain/schedule.ts';
import type { HostResolver, ResolvedAddress } from './server/address-policy.ts';
import {
  ArticleSynthesisError,
  type ArticleSynthesisRequest,
  type ArticleSynthesizer,
  type ArticleToStore,
  type SynthesizedArticle,
} from './server/article-synthesizer.ts';
import type { CollectionDependencies } from './server/collection-run.ts';
import { feedCursors } from './server/schema.ts';

/** The address every test host resolves to unless the test says otherwise. */
export const PUBLIC_TEST_ADDRESS = '93.184.215.14';

export type IsolatedDatabase = { database: Database; close(): Promise<void> };

/** A new database in the test PostgreSQL, migrated from empty; close() drops it. */
export async function isolatedDatabase(): Promise<IsolatedDatabase> {
  const serverUrl = process.env.DATABASE_URL;
  if (!serverUrl) {
    throw new Error('DATABASE_URL must point at the test PostgreSQL.');
  }
  const name = `collect_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  await migrateTestDatabase(url.href);
  const connection = createDatabase(url.href, { max: 2 });
  return {
    database: connection.database,
    async close() {
      await connection.client.end({ timeout: 5 });
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}

/** Empties every table the job writes and leaves the lease free, as a fresh database has it. */
export async function resetCollectionTables(database: Database) {
  await database.execute(sql`
    truncate articles, article_sentences, visits, audio_assets, seen_items, feed_cursors,
      synthesis_cpu_months, usage_records, operation_receipts cascade`);
  await database.execute(sql`
    update job_leases set holder = null, expires_at = '-infinity'
    where name = ${COLLECT_LEASE_NAME}`);
}

function isBucketRequest(data: unknown) {
  const bucket = process.env.S3_ENDPOINT;
  const request = (data as { request?: Request }).request;
  return Boolean(bucket && request?.url.startsWith(bucket));
}

/** MSW for feeds and pages; requests to the S3Mock bucket go through, any other one fails. */
export function feedServer() {
  const server = setupServer();
  const listen = () =>
    server.listen({
      onUnhandledFrame({ frame, defaults }) {
        if (!isBucketRequest(frame.data)) {
          defaults.error();
        }
      },
    });
  return { server, listen };
}

/** Resolves every host to the public test address, except the hosts given their own addresses. */
export function testResolver(
  hosts: Readonly<Record<string, readonly string[]>> = {},
): HostResolver {
  return async (hostname) => {
    const addresses = hosts[hostname] ?? [PUBLIC_TEST_ADDRESS];
    return addresses.map((address): ResolvedAddress => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }));
  };
}

export type SynthesizerDouble = {
  load: () => Promise<ArticleSynthesizer>;
  /** How many times the run made the synthesizer ready. */
  loads: number;
  requests: ArticleSynthesisRequest[];
  /** Makes every synthesis from now on throw this error; null makes them succeed again. */
  failWith(error: Error | null): void;
};

/** A synthesizer that gives every sentence one second of audio, or fails as it is told. */
export function synthesizerDouble(): SynthesizerDouble {
  let failure: Error | null = null;
  const synthesizer: ArticleSynthesizer = {
    voice: {
      provider: 'test-speech',
      model: 'test-voice-model',
      voice: 'F1',
      modelRevision: 'test-revision',
      encoding: 'mp3-mono-32k-test',
    },
    async synthesize(request): Promise<SynthesizedArticle> {
      double.requests.push(request);
      if (failure) {
        throw failure;
      }
      const count = request.sentences.length;
      return {
        byteSize: 4000 * count,
        durationMs: 1000 * count,
        sentenceTimings: request.sentences.map((_, index) => ({
          startMs: index * 1000,
          endMs: index * 1000 + 900,
        })),
        cpuMs: 25,
      };
    },
  };
  const double: SynthesizerDouble = {
    async load() {
      double.loads += 1;
      return synthesizer;
    },
    loads: 0,
    requests: [],
    failWith(error) {
      failure = error;
    },
  };
  return double;
}

export function ttsFailure() {
  return new ArticleSynthesisError('tts_error', 'The test model failed.');
}

/** Records every article the run made room for, and never evicts. */
export function storageRoomDouble() {
  const articles: ArticleToStore[] = [];
  return {
    articles,
    async makeRoomFor(article: ArticleToStore) {
      articles.push(article);
    },
  };
}

/**
 * The committed configuration with every feed turned off except the ones given, which are on
 * and take the given settings. The keys are those of config/shared.json.
 */
export function testConfig(
  feeds: Readonly<Record<string, Partial<FeedCollection>>>,
): CollectionConfig {
  const configured = Object.fromEntries(
    Object.entries(collectionConfig.feeds).map(([key, settings]) => {
      const given = feeds[key];
      return [
        key,
        given ? { ...settings, enabled: true, ...given } : { ...settings, enabled: false },
      ];
    }),
  );
  return { ...collectionConfig, feeds: configured };
}

/** Sets a feed's cursor so that its latest `count` collection times are due now. */
export async function makeFeedDue(
  database: Database,
  feedKey: string,
  config: CollectionConfig,
  count = 1,
) {
  const schedule = config.feeds[feedKey];
  const now = new Date();
  const recent = occurrencesBetween(schedule, new Date(now.getTime() - 20 * 86_400_000), now);
  const lastOccurrenceAt = recent[recent.length - 1 - count];
  await database
    .insert(feedCursors)
    .values({ feedKey, lastOccurrenceAt })
    .onConflictDoUpdate({
      target: feedCursors.feedKey,
      set: { lastOccurrenceAt, failedAttempts: 0, retryAt: null },
    });
}

/** The dependencies of a test run: the test database, bucket, resolver and stand-ins. */
export function testDependencies(
  database: Database,
  overrides: Partial<CollectionDependencies> = {},
): Partial<CollectionDependencies> {
  return {
    database,
    storage: createObjectStorage(storageSettingsFromEnv()),
    resolveHost: testResolver(),
    loadSynthesizer: synthesizerDouble().load,
    storageRoom: storageRoomDouble(),
    ...overrides,
  };
}

const places = ['river', 'orchard', 'harbor', 'meadow', 'canyon', 'glacier', 'prairie', 'delta'];

/**
 * Made-up article text of exactly `sentenceCount` ten-word sentences, five to a paragraph. The
 * seed, a single word, makes every article's text its own.
 */
export function articleParagraphs(seed: string, sentenceCount: number): string[] {
  const sentences = Array.from({ length: sentenceCount }, (_, index) => {
    const place = places[index % places.length];
    return `Survey ${seed} counted ${index + 1} birds near the ${place} this morning.`;
  });
  const paragraphs: string[] = [];
  for (let start = 0; start < sentences.length; start += 5) {
    paragraphs.push(sentences.slice(start, start + 5).join(' '));
  }
  return paragraphs;
}

export function articleHtml(seed: string, sentenceCount: number): string {
  return articleParagraphs(seed, sentenceCount)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join('\n');
}

export type FeedEntryFixture = {
  link: string;
  title: string;
  /** As the feed writes it; none leaves the element out. */
  published?: string;
  /** HTML content of the entry. */
  html?: string;
};

function escapeXml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** An RSS 2.0 document with these entries, the content in content:encoded. */
export function rssFeed(entries: readonly FeedEntryFixture[]): string {
  const items = entries.map(
    (entry) => `<item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.link)}</link>
      ${entry.published ? `<pubDate>${entry.published}</pubDate>` : ''}
      ${entry.html ? `<content:encoded><![CDATA[${entry.html}]]></content:encoded>` : ''}
    </item>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel><title>Test feed</title><link>https://feeds.example.org/</link>${items.join('')}</channel>
    </rss>`;
}

/** A page whose article is this HTML, among the parts of a page that are not. */
export function articlePage(title: string, html: string): string {
  return `<!doctype html><html><head><title>${escapeXml(title)}</title></head><body>
    <nav><a href="/">Home</a></nav>
    <article><h1>${escapeXml(title)}</h1>${html}</article>
    <footer>Footer text</footer></body></html>`;
}

/** The S3Mock bucket, for putting objects there and checking they are gone. */
export function testBucket() {
  const settings = storageSettingsFromEnv();
  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: true,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
  return {
    async put(key: string) {
      await client.send(
        new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: 'test audio' }),
      );
    },
    async has(key: string) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Storage that fails every deletion, for the retry of retiring audio. */
export const failingStorage: ObjectStorage = {
  async deleteObject() {
    throw new Error('The bucket is unreachable.');
  },
};
