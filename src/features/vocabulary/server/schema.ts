// Each member's vocabulary cards, the cards' own example sentences and their Translate options
// (.docs/design/data.md, 生词本). One card per meaning is kept by the save flow, not by a unique
// constraint, since a meaning has no key of its own.
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { englishDocument, timestamptz, tsvector, uuidPrimaryKey } from '../../../lib/db/columns.ts';
import { members } from '../../../lib/db/schema.ts';
import {
  exampleChecks,
  exampleColumns,
  lookupEntries,
  meaningChecks,
  meaningColumns,
} from '../../lookup/index.ts';
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
