// Fixed rules of the collection pipeline (.docs/design/rules.md, 收集流水线 and 保留期限).

/** Name of the lease row that keeps two runs of the collection job from overlapping. */
export const COLLECT_LEASE_NAME = 'collect';

/**
 * How long a run holds the lease. It is longer than the job's 60-minute timeout, so a run never
 * renews it, and the lease of a run that was stopped runs out by itself.
 */
export const LEASE_MINUTES = 70;

/**
 * A run starts no new synthesis this long after it began. The longest article takes about 7.5
 * minutes, so one started at the cutoff still ends before the job's 60-minute timeout.
 */
export const SYNTHESIS_WINDOW_MINUTES = 45;

/** Collection times of one feed a run processes at most; earlier ones are given up. */
export const MAX_DUE_OCCURRENCES = 4;

/** Failed reads of a feed's next collection time before that time is given up. */
export const MAX_FEED_ATTEMPTS = 5;

/** How long the collection job keeps the rows it removes at the end of each run. */
export const RETENTION = {
  failedArticleDays: 30,
  seenItemDays: 180,
  pendingAudioMinutes: 60,
} as const;
