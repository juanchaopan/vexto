// Keeping the audio storage under its cap before each article synthesis (.docs/design/rules.md,
// 朗读和存储上限; .docs/design/data.md, 什么删掉什么). When eviction is due, the oldest ready
// audio goes first, in batches: one transaction per batch marks the audio retiring and deletes
// the articles whose audio it is, with their sentences and everyone's visits. Once enough is
// marked, the objects and then the rows of the retiring audio are removed. Audio the pass marked
// counts as gone from then on, so a bucket that refuses deletions never makes it evict more; the
// next pass tries those deletions again. Word and example audio is evicted the same way and made
// again when it is next played.
import { inArray } from 'drizzle-orm';
import type { CollectionConfig } from '../../../lib/config/collection-config.ts';
import type { SpeechConfig } from '../../../lib/config/speech-config.ts';
import type { Database } from '../../../lib/db/client.ts';
import { log } from '../../../lib/log.ts';
import type { ObjectStorage } from '../../../lib/storage/object-storage.ts';
import { articles } from '../../articles/index.ts';
import {
  deleteRetiringAudio,
  oldestReadyAudio,
  retireAudio,
  storedAudioBytes,
  type StoredAudio,
} from '../../audio/index.ts';
import {
  bytesOverTarget,
  estimatedArticleBytes,
  evictionCount,
  needsEviction,
} from '../domain/storage-eviction.ts';
import type { ArticleToStore, AudioStorageRoom } from './article-synthesizer.ts';

export type StorageRoomDependencies = {
  database: Database;
  storage: ObjectStorage;
  config: CollectionConfig;
  speech: SpeechConfig;
};

/** Retires the audio and deletes its articles in one transaction; returns what was retired. */
async function retireBatch(database: Database, batch: readonly StoredAudio[]) {
  if (batch.length === 0) {
    return [];
  }
  return database.transaction(async (tx) => {
    const retired = new Set(
      await retireAudio(
        tx,
        batch.map((audio) => audio.id),
      ),
    );
    if (retired.size > 0) {
      await tx.delete(articles).where(inArray(articles.audioAssetId, [...retired]));
    }
    return batch.filter((audio) => retired.has(audio.id));
  });
}

export function createAudioStorageRoom(dependencies: StorageRoomDependencies): AudioStorageRoom {
  const { database, storage, config, speech } = dependencies;
  const cap = config.storage;
  const rate = {
    wordsPerMinute: config.synthesisEstimate.wordsPerMinute,
    bitrateKbps: speech.encoding.bitrateKbps,
    sentenceGapMs: speech.sentenceGapMs,
  };

  /** Marks the oldest audio retiring until the target is met; returns the bytes left. */
  async function markOldest(storedBytes: number, incomingBytes: number) {
    let remaining = storedBytes;
    let marked = 0;
    while (bytesOverTarget(remaining, incomingBytes, cap) >= 0) {
      const batch = await oldestReadyAudio(database, cap.evictBatchSize);
      const count = evictionCount(
        batch.map((audio) => audio.byteSize),
        bytesOverTarget(remaining, incomingBytes, cap),
      );
      const retired = await retireBatch(database, batch.slice(0, count));
      if (retired.length === 0) {
        log('WARNING', 'No ready audio is left to evict.', { storedBytes: remaining });
        break;
      }
      remaining -= retired.reduce((sum, audio) => sum + audio.byteSize, 0);
      marked += retired.length;
    }
    return { remaining, marked };
  }

  return {
    async makeRoomFor(article: ArticleToStore) {
      const incomingBytes = estimatedArticleBytes(article, rate);
      const storedBytes = await storedAudioBytes(database);
      if (!needsEviction(storedBytes, incomingBytes, cap)) {
        return;
      }
      const { remaining, marked } = await markOldest(storedBytes, incomingBytes);
      const deletion = await deleteRetiringAudio(database, storage);
      log('INFO', 'Audio evicted to keep the storage under its cap.', {
        articleId: article.articleId,
        evicted: marked,
        objectsDeleted: deletion.deleted,
        objectsLeft: deletion.failed,
        storedBytesBefore: storedBytes,
        storedBytesAfter: remaining,
        incomingBytes,
      });
    },
  };
}
