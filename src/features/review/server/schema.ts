// Review progress, one row per card and mode (.docs/design/data.md, review_progress). A card's
// state (New, Ongoing, Archived) is derived from its three rows and not stored.
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { isBetween, isOneOf, timestamptz } from '../../../lib/db/columns.ts';
import { members } from '../../account/index.ts';
import { vocabularyCards } from '../../vocabulary/index.ts';
import { FINAL_ROUND, REVIEW_MODES, type ReviewMode } from '../domain/review-progress.ts';

export const reviewProgress = pgTable(
  'review_progress',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => members.id),
    cardId: uuid('card_id')
      .notNull()
      .references(() => vocabularyCards.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<ReviewMode>().notNull(),
    round: integer('round').notNull(),
    dueAt: timestamptz('due_at'),
  },
  (t) => [
    primaryKey({ name: 'review_progress_pkey', columns: [t.ownerId, t.cardId, t.mode] }),
    index('review_progress_owner_id_mode_due_at_card_id_idx').on(
      t.ownerId,
      t.mode,
      t.dueAt,
      t.cardId,
    ),
    index('review_progress_owner_id_mode_round_card_id_idx').on(
      t.ownerId,
      t.mode,
      t.round,
      t.cardId,
    ),
    check('review_progress_mode_check', isOneOf(t.mode, REVIEW_MODES)),
    check('review_progress_round_check', isBetween(t.round, 0, FINAL_ROUND)),
    // Only a new word (round 0) and a completed mode (the final round) have no due time.
    check(
      'review_progress_due_at_check',
      sql`${t.dueAt} is not null or ${t.round} in (0, ${sql.raw(String(FINAL_ROUND))})`,
    ),
  ],
);
