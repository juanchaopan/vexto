// The audio storage cap (.docs/design/rules.md, 朗读和存储上限). Before an article is synthesized,
// eviction starts when the stored audio has reached the eviction ratio of the cap, or would pass
// it with the article's estimated audio; it then takes the oldest audio until the stored audio
// and the article together fall below the target ratio.

export type StorageCap = {
  capBytes: number;
  /** Eviction starts at this share of the cap. */
  evictAtRatio: number;
  /** Eviction goes on until the stored audio is below this share. */
  evictToRatio: number;
};

export type ArticleSize = { wordCount: number; sentenceCount: number };

export type AudioRate = {
  /** Words read per minute of audio. */
  wordsPerMinute: number;
  bitrateKbps: number;
  /** Silence between two sentences. */
  sentenceGapMs: number;
};

/**
 * The expected MP3 size of an article: its reading time at the planned pace plus the silences
 * between its sentences, at the constant bitrate (kbps ÷ 8 is bytes per millisecond).
 */
export function estimatedArticleBytes(article: ArticleSize, rate: AudioRate): number {
  const readingMs = (article.wordCount / rate.wordsPerMinute) * 60_000;
  const silenceMs = Math.max(0, article.sentenceCount - 1) * rate.sentenceGapMs;
  return Math.ceil(((readingMs + silenceMs) * rate.bitrateKbps) / 8);
}

/** Whether eviction must run before storing about `incomingBytes` more. */
export function needsEviction(
  storedBytes: number,
  incomingBytes: number,
  cap: StorageCap,
): boolean {
  const threshold = cap.capBytes * cap.evictAtRatio;
  return storedBytes >= threshold || storedBytes + incomingBytes > threshold;
}

/**
 * Bytes over the target: freeing more than this brings the stored audio and the incoming
 * article below the target ratio. Zero or less means nothing more has to go.
 */
export function bytesOverTarget(storedBytes: number, incomingBytes: number, cap: StorageCap) {
  return storedBytes + incomingBytes - cap.capBytes * cap.evictToRatio;
}

/**
 * How many of these audio sizes, oldest first, to evict to free more than `excessBytes`; all of
 * them when they are not enough, none when nothing is over.
 */
export function evictionCount(sizes: readonly number[], excessBytes: number): number {
  if (excessBytes < 0) {
    return 0;
  }
  let freed = 0;
  for (const [index, size] of sizes.entries()) {
    freed += size;
    if (freed > excessBytes) {
      return index + 1;
    }
  }
  return sizes.length;
}
