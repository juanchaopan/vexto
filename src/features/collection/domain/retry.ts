// Waits between failed attempts of the collection job (.docs/design/rules.md, 失败和重试 and
// 调度). Feed reads and article syntheses wait the same way; the waits are multiples of the
// job's 15-minute schedule, so each retry falls on a run.
import { MAX_FEED_ATTEMPTS } from './collection-state.ts';

const MINUTE_MS = 60_000;

/** The waits after the 1st to the 4th failed attempt, in minutes. */
export const RETRY_DELAYS_MINUTES = [15, 30, 60, 120] as const;

/** The wait after the given attempt (counted from 1); attempts after the 4th wait as long. */
export function retryDelayMinutes(attempt: number): number {
  const index = Math.min(Math.max(Math.trunc(attempt), 1), RETRY_DELAYS_MINUTES.length) - 1;
  return RETRY_DELAYS_MINUTES[index];
}

export function addMinutes(time: Date, minutes: number): Date {
  return new Date(time.getTime() + minutes * MINUTE_MS);
}

/** When the given attempt, started or failed at `now`, may be tried again. */
export function retryTime(now: Date, attempt: number): Date {
  return addMinutes(now, retryDelayMinutes(attempt));
}

/** What happens to a feed's collection time when reading the feed failed once more. */
export type FeedReadFailure =
  { kind: 'retry'; failedAttempts: number; retryAt: Date } | { kind: 'give-up' };

/**
 * After a failed read: the failure is counted and the read waits for its retry time, until the
 * 5th failure gives the collection time up.
 */
export function afterFeedReadFailure(previousFailures: number, now: Date): FeedReadFailure {
  const failedAttempts = previousFailures + 1;
  if (failedAttempts >= MAX_FEED_ATTEMPTS) {
    return { kind: 'give-up' };
  }
  return { kind: 'retry', failedAttempts, retryAt: retryTime(now, failedAttempts) };
}
