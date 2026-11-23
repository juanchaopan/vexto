// Each member's lookup cache and the example sentences of each lookup (.docs/design/data.md, 查词).
// A vocabulary card's examples have the same columns and constraints, so the vocabulary feature
// builds its table from exampleColumns() and exampleChecks() as well.
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { isOneOf, uuidPrimaryKey } from '../../../lib/db/columns.ts';
import { members } from '../../../lib/db/schema.ts';
import {
  MEANING_MAX_LENGTH,
  PARTS_OF_SPEECH,
  type PartOfSpeech,
  type TargetRange,
} from '../domain/lookup-entry.ts';

type MeaningColumns = {
  pos: AnyPgColumn;
  meaningZh: AnyPgColumn;
  acceptedForms: AnyPgColumn;
};

/** Columns of the meaning a lookup result and a vocabulary card both store. */
export function meaningColumns() {
  return {
    lemma: text('lemma').notNull(),
    lemmaKey: text('lemma_key').notNull(),
    pos: text('pos').$type<PartOfSpeech>().notNull(),
    meaningZh: text('meaning_zh').notNull(),
    acceptedForms: text('accepted_forms').array().notNull(),
  };
}

/** CHECK constraints of the meaning columns, named after the table they are on. */
export function meaningChecks(table: string, t: MeaningColumns) {
  return [
    check(`${table}_pos_check`, isOneOf(t.pos, PARTS_OF_SPEECH)),
    check(
      `${table}_meaning_zh_check`,
      sql`char_length(${t.meaningZh}) <= ${sql.raw(String(MEANING_MAX_LENGTH))}`,
    ),
    check(`${table}_accepted_forms_check`, sql`cardinality(${t.acceptedForms}) >= 1`),
  ];
}

/** Columns of an example sentence, apart from the reference to the lookup or card it belongs to. */
export function exampleColumns() {
  return {
    id: uuidPrimaryKey(),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    targetRanges: jsonb('target_ranges').$type<TargetRange[]>().notNull(),
    contentHash: text('content_hash').notNull(),
  };
}

/** CHECK constraints of an example sentence, named after the table they are on. */
export function exampleChecks(
  table: string,
  t: { position: AnyPgColumn; targetRanges: AnyPgColumn },
) {
  return [
    check(`${table}_position_check`, sql`${t.position} >= 0`),
    check(
      `${table}_target_ranges_check`,
      sql`jsonb_typeof(${t.targetRanges}) = 'array' and jsonb_array_length(${t.targetRanges}) > 0`,
    ),
  ];
}

export const lookupEntries = pgTable(
  'lookup_entries',
  {
    id: uuidPrimaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => members.id),
    contextText: text('context_text').notNull(),
    contextHash: text('context_hash').notNull(),
    selectionStart: integer('selection_start').notNull(),
    selectionEnd: integer('selection_end').notNull(),
    selectedText: text('selected_text').notNull(),
    ...meaningColumns(),
  },
  (t) => [
    unique('lookup_entries_owner_id_context_hash_selection_key').on(
      t.ownerId,
      t.contextHash,
      t.selectionStart,
      t.selectionEnd,
    ),
    ...meaningChecks('lookup_entries', t),
  ],
);

export const examples = pgTable(
  'examples',
  {
    ...exampleColumns(),
    lookupEntryId: uuid('lookup_entry_id')
      .notNull()
      .references(() => lookupEntries.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('examples_lookup_entry_id_position_key').on(t.lookupEntryId, t.position),
    unique('examples_lookup_entry_id_content_hash_key').on(t.lookupEntryId, t.contentHash),
    ...exampleChecks('examples', t),
  ],
);
