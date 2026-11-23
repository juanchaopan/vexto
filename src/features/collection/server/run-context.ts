// What every step of one collection run works with: the database, the configuration, the clocks,
// the limited fetch and the synthesis and storage the run was given.
import type { CollectionConfig } from '../../../lib/config/collection-config.ts';
import type { Database } from '../../../lib/db/client.ts';
import type { ObjectStorage } from '../../../lib/storage/object-storage.ts';
import type { ArticleSynthesizer, AudioStorageRoom } from './article-synthesizer.ts';
import type { FetchedResource } from './limited-fetch.ts';

/** A feed document, or the original page of an entry; each gets its own Accept header. */
export type ResourceKind = 'feed' | 'page';

export type CollectionRun = {
  /** The ID this run holds the lease under, also written into its log entries. */
  runId: string;
  database: Database;
  config: CollectionConfig;
  /** The category key a feed's articles get, from the shared configuration. */
  categoryOf(feedKey: string): string;
  /** The current time; times the run writes and compares come from it. */
  now(): Date;
  /** Milliseconds since the run started, on a monotonic clock. */
  elapsedMs(): number;
  /** How long after its start the run may still start a synthesis. */
  synthesisWindowMs: number;
  fetchResource(url: string, kind: ResourceKind): Promise<FetchedResource>;
  /** The synthesizer, made ready on the first call and kept for the rest of the run. */
  synthesizer(): Promise<ArticleSynthesizer>;
  storageRoom: AudioStorageRoom;
  storage: ObjectStorage;
};
