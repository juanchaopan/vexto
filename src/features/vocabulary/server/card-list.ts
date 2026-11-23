// The Vocabulary list (.docs/design/rules.md, 列表). Each card is joined with its three progress
// rows, one per mode, which give its state and its rounds and due times. The search matches a
// card whose lemma, meaning, part of speech or one of whose examples contains the text, case
// aside (a bound `ILIKE` pattern with `%` and `_` escaped), or whose example matches it as an
// English full-text search, so inflections are found too.
//
// Word sorts by the lemma key; a mode's Round by its round; a mode's Next by the due time, with
// new and completed words, which have none, last in either direction. Equal values go by the lemma
// key, then the ID, in the same direction, which keeps the order total, and batches continue after
// a keyset cursor of those values.
import { and, count, eq, inArray, not, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  decodeCursor,
  invalidCursor,
  microsecondTime,
  PAGE_SIZE,
  takePage,
  type CursorValue,
} from '../../../lib/api/cursor.ts';
import type { Executor } from '../../../lib/db/client.ts';
import { isoOrNull, microsecondText } from '../../../lib/db/columns.ts';
import { canonicalJson, sha256Hex } from '../../../lib/digest.ts';
import type { PartOfSpeech } from '../../lookup/index.ts';
import {
  FINAL_ROUND,
  REVIEW_MODES,
  type CardProgress,
  type ReviewMode,
} from '../domain/review-progress.ts';
import {
  containsPattern,
  roundsOfChoices,
  sortKeyOf,
  type VocabularyQuery,
} from '../domain/vocabulary-query.ts';
import { reviewProgress, vocabularyCards, vocabularyExamples } from './schema.ts';

export type CardListItem = {
  id: string;
  lemma: string;
  pos: PartOfSpeech;
  meaningZh: string;
  progress: CardProgress;
};

export type CardListBatch = {
  items: CardListItem[];
  nextCursor: string | null;
  totalCount: number;
};

const progressRows = {
  speak: alias(reviewProgress, 'speak_progress'),
  spell: alias(reviewProgress, 'spell_progress'),
  translate: alias(reviewProgress, 'translate_progress'),
};

function joinProgress(mode: ReviewMode, ownerId: string) {
  const row = progressRows[mode];
  return and(eq(row.cardId, vocabularyCards.id), eq(row.ownerId, ownerId), eq(row.mode, mode));
}

const everyMode = (condition: (mode: ReviewMode) => SQL) =>
  and(...REVIEW_MODES.map(condition)) as SQL;

const isNew = everyMode(
  (mode) => sql`(${progressRows[mode].round} = 0 and ${progressRows[mode].dueAt} is null)`,
);
const isArchived = everyMode((mode) => sql`${progressRows[mode].round} = ${FINAL_ROUND}`);

function stateFilter(state: VocabularyQuery['state']): SQL | undefined {
  switch (state) {
    case 'new':
      return isNew;
    case 'archived':
      return isArchived;
    case 'ongoing':
      return and(not(isNew), not(isArchived));
    default:
      return undefined;
  }
}

function searchFilter(q: string): SQL {
  const pattern = containsPattern(q);
  const contains = (text: AnyColumn) => sql`${text} ilike ${pattern} escape '\\'`;
  const example = sql`exists (select 1 from ${vocabularyExamples} where ${vocabularyExamples.cardId} = ${vocabularyCards.id} and (${contains(vocabularyExamples.text)} or ${vocabularyExamples.textFts} @@ plainto_tsquery('english', ${q})))`;
  return or(
    contains(vocabularyCards.lemma),
    contains(vocabularyCards.meaningZh),
    contains(vocabularyCards.pos),
    example,
  ) as SQL;
}

function filtersOf(ownerId: string, query: VocabularyQuery): SQL[] {
  const filters: SQL[] = [eq(vocabularyCards.ownerId, ownerId)];
  const state = stateFilter(query.state);
  if (state) {
    filters.push(state);
  }
  for (const mode of REVIEW_MODES) {
    const choices = query.rounds[mode];
    if (choices.length > 0) {
      filters.push(inArray(progressRows[mode].round, roundsOfChoices(choices)));
    }
  }
  if (query.q !== '') {
    filters.push(searchFilter(query.q));
  }
  return filters;
}

/** The value a sort leads with, before the lemma key and the ID. */
type LeadingSort = {
  value: SQL;
  /** The value as the cursor holds it. */
  key: SQL;
  /** True when rows without a value come last in either direction. */
  nullable: boolean;
  /** The shape a cursor value must have, and how it is compared once checked. */
  cursorValue: z.ZodType<string | number>;
  bound: (value: string | number) => SQL;
};

/** The leading value of the query's sort; the word sort has none, only the lemma key. */
function leadingSort(query: VocabularyQuery): LeadingSort | null {
  const sortKey = sortKeyOf(query.sort);
  if (sortKey.kind === 'word') {
    return null;
  }
  const row = progressRows[sortKey.mode];
  if (sortKey.kind === 'round') {
    return {
      value: sql`${row.round}`,
      key: sql`${row.round}`,
      nullable: false,
      cursorValue: z.number().int().min(0).max(FINAL_ROUND),
      bound: (value) => sql`${value}::integer`,
    };
  }
  return {
    value: sql`${row.dueAt}`,
    key: microsecondText(row.dueAt),
    nullable: true,
    cursorValue: microsecondTime,
    bound: (value) => sql`${value}::timestamptz`,
  };
}

function orderBy(query: VocabularyQuery): SQL[] {
  const direction = query.direction === 'asc' ? sql`asc` : sql`desc`;
  const tail = [
    sql`${vocabularyCards.lemmaKey} ${direction}`,
    sql`${vocabularyCards.id} ${direction}`,
  ];
  const lead = leadingSort(query);
  if (lead === null) {
    return tail;
  }
  const ordered = [sql`${lead.value} ${direction}`, ...tail];
  return lead.nullable ? [sql`(${lead.value} is null) asc`, ...ordered] : ordered;
}

/** The cursor's scope: the sort, the direction and a digest of the tab, search and filters. */
function cursorScope(query: VocabularyQuery): string {
  const narrowing = sha256Hex(
    canonicalJson({ state: query.state, q: query.q, rounds: query.rounds }),
  );
  return `vocabulary:${query.sort}:${query.direction}:${narrowing.slice(0, 16)}`;
}

const cursorId = z.uuid();
const cursorLemmaKey = z.string().max(1000);

function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : invalidCursor();
}

/** Rows after the cursor's values, in the query's order. */
function afterCursor(query: VocabularyQuery, cursor: string): SQL {
  const [rawValue, rawLemmaKey, rawId] = decodeCursor(cursorScope(query), cursor, 3);
  const id = checked(cursorId, rawId);
  const lemmaKey = checked(cursorLemmaKey, rawLemmaKey);
  const beyond = query.direction === 'asc' ? sql`>` : sql`<`;
  const tail = sql`(${vocabularyCards.lemmaKey}, ${vocabularyCards.id}) ${beyond} (${lemmaKey}::text, ${id}::uuid)`;
  const lead = leadingSort(query);
  if (lead === null) {
    return rawValue === null ? tail : invalidCursor();
  }
  if (rawValue === null) {
    return lead.nullable ? sql`(${lead.value} is null and ${tail})` : invalidCursor();
  }
  const bound = lead.bound(checked(lead.cursorValue, rawValue));
  const after = sql`(${lead.value}, ${vocabularyCards.lemmaKey}, ${vocabularyCards.id}) ${beyond} (${bound}, ${lemmaKey}::text, ${id}::uuid)`;
  return lead.nullable
    ? sql`((${lead.value} is not null and ${after}) or ${lead.value} is null)`
    : after;
}

function progressColumns(mode: ReviewMode) {
  return { round: progressRows[mode].round, dueAt: progressRows[mode].dueAt };
}

function progressOfRow(row: Record<ReviewMode, { round: number; dueAt: Date | null }>) {
  const modeProgress = (mode: ReviewMode) => ({
    round: row[mode].round,
    dueAt: isoOrNull(row[mode].dueAt),
  });
  return {
    speak: modeProgress('speak'),
    spell: modeProgress('spell'),
    translate: modeProgress('translate'),
  };
}

/** One batch of the member's cards, the cursor of the next batch and the total count. */
export async function listCards(
  executor: Executor,
  ownerId: string,
  query: VocabularyQuery,
  cursor?: string,
): Promise<CardListBatch> {
  const filters = filtersOf(ownerId, query);
  const where = cursor === undefined ? filters : [...filters, afterCursor(query, cursor)];
  const lead = leadingSort(query);
  const [rows, [{ total }]] = await Promise.all([
    executor
      .select({
        id: vocabularyCards.id,
        lemma: vocabularyCards.lemma,
        lemmaKey: vocabularyCards.lemmaKey,
        pos: vocabularyCards.pos,
        meaningZh: vocabularyCards.meaningZh,
        speak: progressColumns('speak'),
        spell: progressColumns('spell'),
        translate: progressColumns('translate'),
        sortKey: lead === null ? sql<CursorValue>`null` : sql<CursorValue>`${lead.key}`,
      })
      .from(vocabularyCards)
      .innerJoin(progressRows.speak, joinProgress('speak', ownerId))
      .innerJoin(progressRows.spell, joinProgress('spell', ownerId))
      .innerJoin(progressRows.translate, joinProgress('translate', ownerId))
      .where(and(...where))
      .orderBy(...orderBy(query))
      .limit(PAGE_SIZE + 1),
    executor
      .select({ total: count() })
      .from(vocabularyCards)
      .innerJoin(progressRows.speak, joinProgress('speak', ownerId))
      .innerJoin(progressRows.spell, joinProgress('spell', ownerId))
      .innerJoin(progressRows.translate, joinProgress('translate', ownerId))
      .where(and(...filters)),
  ]);
  const page = takePage(rows, cursorScope(query), (row) => [row.sortKey, row.lemmaKey, row.id]);
  return {
    items: page.items.map((row) => ({
      id: row.id,
      lemma: row.lemma,
      pos: row.pos,
      meaningZh: row.meaningZh,
      progress: progressOfRow(row),
    })),
    nextCursor: page.nextCursor,
    totalCount: total,
  };
}
