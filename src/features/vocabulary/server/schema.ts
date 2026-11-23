// Each member's vocabulary cards, the cards' own example sentences, their Translate options and
// their review progress (.docs/design/data.md, 生词本). One card per meaning is kept by the save
// flow, not by a unique constraint, since a meaning has no key of its own. A card's state (New,
// Ongoing, Archived) is derived from its three progress rows and not stored. The review feature
// reads the cards and moves the progress on through this feature's index.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  englishDocument,
  isBetween,
  isOneOf,
  timestamptz,
  tsvector,
  uuidPrimaryKey,
} from '../../../lib/db/columns.ts';
import { members } from '../../../lib/db/schema.ts';
import {
  exampleChecks,
  exampleColumns,
  lookupEntries,
  meaningChecks,
  meaningColumns,
} from '../../lookup/index.ts';
import { FINAL_ROUND, REVIEW_MODES, type ReviewMode } from '../domain/review-progress.ts';
import { TRANSLATION_OPTION_COUNT, type TranslationOption } from '../domain/translation-set.ts';

export const vocabularyCards = pgTable(
  'vocabulary_cards',
  {
    id: uuidPrimaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => members.id),
    sourceLookupEntryId: uuid('source_lookup_entry_id').references(() => lookupEntries.id, {
      onDelete: 'set null',
    }),
    ...meaningColumns(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('vocabulary_cards_owner_id_lemma_key_pos_idx').on(t.ownerId, t.lemmaKey, t.pos),
    index('vocabulary_cards_owner_id_lemma_key_id_idx').on(t.ownerId, t.lemmaKey, t.id),
    index('vocabulary_cards_owner_id_created_at_id_idx').on(t.ownerId, t.createdAt, t.id),
    index('vocabulary_cards_source_lookup_entry_id_idx').on(t.sourceLookupEntryId),
    ...meaningChecks('vocabulary_cards', t),
  ],
);

export const vocabularyExamples = pgTable(
  'vocabulary_examples',
  {
    ...exampleColumns(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => vocabularyCards.id, { onDelete: 'cascade' }),
    textFts: tsvector('text_fts')
      .notNull()
      .generatedAlwaysAs(englishDocument((): AnyPgColumn => vocabularyExamples.text)),
  },
  (t) => [
    unique('vocabulary_examples_card_id_position_key').on(t.cardId, t.position),
    unique('vocabulary_examples_card_id_content_hash_key').on(t.cardId, t.contentHash),
    index('vocabulary_examples_text_fts_idx').using('gin', t.textFts),
    ...exampleChecks('vocabulary_examples', t),
  ],
);

export const translationSets = pgTable(
  'translation_sets',
  {
    cardId: uuid('card_id')
      .primaryKey()
      .references(() => vocabularyCards.id, { onDelete: 'cascade' }),
    options: jsonb('options').$type<TranslationOption[]>().notNull(),
    correctOptionId: uuid('correct_option_id').notNull(),
  },
  (t) => [
    check(
      'translation_sets_options_check',
      sql`jsonb_typeof(${t.options}) = 'array' and jsonb_array_length(${t.options}) = ${sql.raw(String(TRANSLATION_OPTION_COUNT))}`,
    ),
    check(
      'translation_sets_correct_option_check',
      sql`${t.options} @> jsonb_build_array(jsonb_build_object('id', ${t.correctOptionId}::text))`,
    ),
  ],
);

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
