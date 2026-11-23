// One run of the collection job (.docs/design/rules.md, 一次执行的顺序): take the lease or leave,
// synthesize the preparing articles whose retry time has come, collect the feeds whose collection
// times have come, remove the expired rows, and give the lease back, also when a step failed.
// Single articles and feeds that fail are recorded and the run goes on; anything else fails the
// run and is thrown to the job's entry.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { collectionConfig, type CollectionConfig } from '../../../lib/config/collection-config.ts';
import { sharedConfig, type FeedDisplay } from '../../../lib/config/shared-config.ts';
import { speechConfig } from '../../../lib/config/speech-config.ts';
import { getDatabase, type Database } from '../../../lib/db/client.ts';
import { log } from '../../../lib/log.ts';
import { objectStorageFromEnv, type ObjectStorage } from '../../../lib/storage/object-storage.ts';
import { SYNTHESIS_WINDOW_MINUTES } from '../domain/collection-state.ts';
import { systemResolver, type HostResolver } from './address-policy.ts';
import type {
  ArticleSynthesizer,
  ArticleSynthesizerLoader,
  AudioStorageRoom,
} from './article-synthesizer.ts';
import { synthesizeDueArticles } from './article-synthesis.ts';
import { collectDueFeeds } from './feed-collection.ts';
import { releaseCollectionLease, takeCollectionLease } from './lease.ts';
import { FETCH_LIMITS, fetchLimited, type FetchLimits } from './limited-fetch.ts';
import { removeExpiredRows } from './retention.ts';
import type { CollectionRun, ResourceKind } from './run-context.ts';
import { speechSynthesizerLoader } from './speech-synthesizer.ts';
import { createAudioStorageRoom } from './storage-room.ts';
import { collectionUserAgent } from './user-agent.ts';

export type CollectionDependencies = {
  database: Database;
  storage: ObjectStorage;
  loadSynthesizer: ArticleSynthesizerLoader;
  storageRoom: AudioStorageRoom;
  resolveHost: HostResolver;
  fetchLimits: FetchLimits;
  config: CollectionConfig;
  /** How the feeds are shown, which gives each feed's category. */
  feeds: readonly FeedDisplay[];
  now: () => Date;
  /** A monotonic clock in milliseconds, for the synthesis window and the synthesis time. */
  monotonicMs: () => number;
  synthesisWindowMs: number;
};

export type CollectionSummary = { runId: string; leased: boolean };

/** The dependencies the synthesis and the storage room are made from. */
type BaseDependencies = Omit<CollectionDependencies, 'loadSynthesizer' | 'storageRoom'>;

type Defaults = { [Key in keyof BaseDependencies]: () => BaseDependencies[Key] };

/** The production dependencies, each made only when the caller does not give it. */
const productionDefaults: Defaults = {
  database: () => getDatabase({ applicationName: 'vexto-collect', max: 2 }),
  storage: () => objectStorageFromEnv(),
  resolveHost: () => systemResolver,
  fetchLimits: () => FETCH_LIMITS,
  config: () => collectionConfig,
  feeds: () => sharedConfig.feeds,
  now: () => () => new Date(),
  monotonicMs: () => () => performance.now(),
  synthesisWindowMs: () => SYNTHESIS_WINDOW_MINUTES * 60_000,
};

/**
 * The given dependencies with the production ones for the rest. The production synthesizer and
 * storage room work on the run's database and bucket.
 */
function withDefaults(given: Partial<CollectionDependencies>): CollectionDependencies {
  const keys = Object.keys(productionDefaults) as (keyof BaseDependencies)[];
  const entries = keys.map((key) => [key, given[key] ?? productionDefaults[key]()]);
  const base = Object.fromEntries(entries) as BaseDependencies;
  return {
    ...base,
    loadSynthesizer: given.loadSynthesizer ?? speechSynthesizerLoader(base.storage, speechConfig),
    storageRoom:
      given.storageRoom ??
      createAudioStorageRoom({
        database: base.database,
        storage: base.storage,
        config: base.config,
        speech: speechConfig,
      }),
  };
}

const ACCEPT: Readonly<Record<ResourceKind, string>> = {
  feed: 'application/rss+xml, application/atom+xml, application/rdf+xml;q=0.9, application/xml;q=0.8, text/xml;q=0.8, */*;q=0.1',
  page: 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1',
};

function categoryLookup(feeds: readonly FeedDisplay[]) {
  const categories = new Map(feeds.map((feed) => [feed.key, feed.category]));
  return (feedKey: string) => {
    const category = categories.get(feedKey);
    if (!category) {
      throw new Error(`The feed ${feedKey} has no category in config/shared.json.`);
    }
    return category;
  };
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => (loaded ??= load());
}

function runOf(runId: string, dependencies: CollectionDependencies): CollectionRun {
  const startedAt = dependencies.monotonicMs();
  const userAgent = collectionUserAgent(dependencies.config.repositoryUrl);
  return {
    runId,
    database: dependencies.database,
    config: dependencies.config,
    categoryOf: categoryLookup(dependencies.feeds),
    now: dependencies.now,
    elapsedMs: () => dependencies.monotonicMs() - startedAt,
    synthesisWindowMs: dependencies.synthesisWindowMs,
    fetchResource: (url, kind) =>
      fetchLimited(url, {
        resolveHost: dependencies.resolveHost,
        userAgent,
        accept: ACCEPT[kind],
        limits: dependencies.fetchLimits,
      }),
    synthesizer: once<ArticleSynthesizer>(dependencies.loadSynthesizer),
    storageRoom: dependencies.storageRoom,
    storage: dependencies.storage,
  };
}

/**
 * Runs the pipeline once. Dependencies that are not given are the production ones: the shared
 * database at DATABASE_URL, the bucket of the S3_* values, the speech model at MODEL_DIR, the
 * system resolver, the committed configuration and the real clocks.
 */
export async function runCollection(
  given: Partial<CollectionDependencies> = {},
): Promise<CollectionSummary> {
  const dependencies = withDefaults(given);
  const runId = randomUUID();
  if (!(await takeCollectionLease(dependencies.database, runId))) {
    log('INFO', 'Another run holds the collection lease; this run leaves.', { runId });
    return { runId, leased: false };
  }
  try {
    const run = runOf(runId, dependencies);
    await synthesizeDueArticles(run);
    await collectDueFeeds(run);
    await removeExpiredRows(run);
  } finally {
    await releaseCollectionLease(dependencies.database, runId);
  }
  return { runId, leased: true };
}
