// Collecting the feeds whose collection times have come (.docs/design/rules.md, 调度 and 选条目).
// A new feed's cursor starts at its latest collection time, so it collects from the next one on
// and never fetches its backlog. A feed that is due is read once per run, and each due collection
// time, from early to late, takes the newest entries not seen before and moves the cursor on. A
// read that fails leaves the cursor where it is and waits for its retry time; the fifth failure
// gives that collection time up.
import type { FeedCollection } from '../../../lib/config/collection-config.ts';
import { sha256Hex } from '../../../lib/digest.ts';
import { log } from '../../../lib/log.ts';
import { newestFirst, parseFeedDate, takeNew } from '../domain/entry-selection.ts';
import { afterFeedReadFailure } from '../domain/retry.ts';
import { dueOccurrences, latestOccurrence } from '../domain/schedule.ts';
import { absoluteLink, normalizeSourceUrl } from '../domain/source-url.ts';
import { collectEntry, type Candidate } from './entry-collection.ts';
import { FeedParseError, parseFeedDocument, type FeedItem } from './feed-document.ts';
import {
  advanceFeedCursor,
  readFeedCursors,
  recordFeedReadFailure,
  startFeedCursor,
  type FeedCursor,
} from './feed-cursors.ts';
import { FetchFailure } from './limited-fetch.ts';
import type { CollectionRun } from './run-context.ts';
import { seenUrlHashes } from './seen-items.ts';
import { decodeText } from './text-decoding.ts';

type Feed = { key: string; settings: FeedCollection };

/** The entries with a usable link, once each, in the feed's order. */
function candidatesOf(items: readonly FeedItem[], feedUrl: string): Candidate[] {
  const byHash = new Map<string, Candidate>();
  for (const item of items) {
    const link = item.link ? absoluteLink(item.link, feedUrl) : null;
    const normalized = link ? normalizeSourceUrl(link) : null;
    if (!link || !normalized) {
      continue;
    }
    const urlHash = sha256Hex(normalized);
    if (!byHash.has(urlHash)) {
      byHash.set(urlHash, { item, link, urlHash, published: parseFeedDate(item.published) });
    }
  }
  return [...byHash.values()];
}

async function recordReadFailure(
  run: CollectionRun,
  feed: Feed,
  cursor: FeedCursor,
  occurrence: Date,
  error: FetchFailure | FeedParseError,
) {
  const failure = afterFeedReadFailure(cursor.failedAttempts, run.now());
  const fields = { runId: run.runId, feedKey: feed.key, occurrence: occurrence.toISOString() };
  if (failure.kind === 'give-up') {
    await advanceFeedCursor(run.database, feed.key, occurrence);
    log('WARNING', 'Reading the feed failed again; its collection time is given up.', {
      ...fields,
      error: error.message,
    });
    return;
  }
  await recordFeedReadFailure(run.database, feed.key, failure.failedAttempts, failure.retryAt);
  log('WARNING', 'Reading the feed failed.', {
    ...fields,
    failedAttempts: failure.failedAttempts,
    retryAt: failure.retryAt.toISOString(),
    error: error.message,
  });
}

/** The feed's entries, or null when reading it failed and the failure was recorded. */
async function readFeed(run: CollectionRun, feed: Feed, cursor: FeedCursor, occurrence: Date) {
  try {
    const resource = await run.fetchResource(feed.settings.url, 'feed');
    const items = parseFeedDocument(decodeText(resource.body, resource.contentType));
    return candidatesOf(items, resource.url);
  } catch (error) {
    if (!(error instanceof FetchFailure || error instanceof FeedParseError)) {
      throw error;
    }
    await recordReadFailure(run, feed, cursor, occurrence, error);
    return null;
  }
}

/** One collection time: the newest entries not seen or tried before in this run. */
async function collectOccurrence(
  run: CollectionRun,
  feed: Feed,
  candidates: readonly Candidate[],
  tried: Set<string>,
) {
  const seen = await seenUrlHashes(
    run.database,
    candidates.map((candidate) => candidate.urlHash),
  );
  const ordered = newestFirst(candidates, (candidate) => candidate.published, run.now());
  const isNew = (candidate: Candidate) =>
    !seen.has(candidate.urlHash) && !tried.has(candidate.urlHash);
  for (const candidate of takeNew(ordered, isNew, feed.settings.perRun)) {
    tried.add(candidate.urlHash);
    await collectEntry(run, feed.key, feed.settings.body, candidate);
  }
}

async function collectFeed(run: CollectionRun, feed: Feed, cursor: FeedCursor | undefined) {
  const now = run.now();
  if (!cursor) {
    const start = latestOccurrence(feed.settings, now);
    await startFeedCursor(run.database, feed.key, start);
    log('INFO', 'Feed cursor started.', {
      runId: run.runId,
      feedKey: feed.key,
      lastOccurrenceAt: start.toISOString(),
    });
    return;
  }
  if (cursor.retryAt && cursor.retryAt > now) {
    return;
  }
  const { due, gaveUpEarlier } = dueOccurrences(feed.settings, cursor.lastOccurrenceAt, now);
  if (due.length === 0) {
    return;
  }
  if (gaveUpEarlier) {
    log('INFO', 'Earlier collection times of the feed are given up.', {
      runId: run.runId,
      feedKey: feed.key,
      from: due[0].toISOString(),
    });
  }
  const candidates = await readFeed(run, feed, cursor, due[0]);
  if (!candidates) {
    return;
  }
  const tried = new Set<string>();
  for (const occurrence of due) {
    await collectOccurrence(run, feed, candidates, tried);
    await advanceFeedCursor(run.database, feed.key, occurrence);
  }
}

/** Collects every enabled feed whose collection times have come. */
export async function collectDueFeeds(run: CollectionRun): Promise<void> {
  const cursors = await readFeedCursors(run.database);
  for (const [key, settings] of Object.entries(run.config.feeds)) {
    if (settings.enabled) {
      await collectFeed(run, { key, settings }, cursors.get(key));
    }
  }
}
