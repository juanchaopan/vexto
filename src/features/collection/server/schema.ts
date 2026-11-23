// State of the collection pipeline, used only by the collection job (.docs/design/data.md): the
// items already seen, each feed's cursor, the lease against overlapping runs and the monthly
// synthesis time the synthesis budget is checked against.
import { sql } from 'drizzle-orm';
import { check, date, index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { isBetween, timestamptz } from '../../../lib/db/columns.ts';
import { MAX_FEED_ATTEMPTS } from '../domain/collection-state.ts';

export const seenItems = pgTable(
  'seen_items',
  {
    urlHash: text('url_hash').primaryKey(),
    firstSeenAt: timestamptz('first_seen_at').notNull().defaultNow(),
  },
  (t) => [index('seen_items_first_seen_at_idx').on(t.firstSeenAt)],
);

export const feedCursors = pgTable(
  'feed_cursors',
  {
    feedKey: text('feed_key').primaryKey(),
    lastOccurrenceAt: timestamptz('last_occurrence_at').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    retryAt: timestamptz('retry_at'),
  },
  (t) => [
    check('feed_cursors_failed_attempts_check', isBetween(t.failedAttempts, 0, MAX_FEED_ATTEMPTS)),
  ],
);

/** The migration inserts the collection job's row, already expired, so the first run takes it. */
export const jobLeases = pgTable('job_leases', {
  name: text('name').primaryKey(),
  holder: uuid('holder'),
  expiresAt: timestamptz('expires_at').notNull(),
});

export const synthesisCpuMonths = pgTable(
  'synthesis_cpu_months',
  {
    month: date('month', { mode: 'string' }).primaryKey(),
    synthesisSeconds: numeric('synthesis_seconds', { precision: 12, scale: 1, mode: 'number' })
      .notNull()
      .default(0),
  },
  (t) => [
    check('synthesis_cpu_months_month_check', sql`extract(day from ${t.month}) = 1`),
    check('synthesis_cpu_months_synthesis_seconds_check', sql`${t.synthesisSeconds} >= 0`),
  ],
);
