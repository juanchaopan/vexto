// Each member's lookup cache (.docs/design/data.md, lookup_entries and examples). An entry is
// found by its owner, the hash of its normalized context and the selection, and the context text
// itself is compared too, so a hash that happens to match never answers for another context. The
// examples of an entry keep their positions; refreshing one deletes it and inserts the new one at
// the same position with a new ID, inside a transaction that holds the entry's row.
import { and, asc, eq, ne } from 'drizzle-orm';
import { ApiError } from '../../../lib/api/errors.ts';
import type { Executor, Transaction } from '../../../lib/db/client.ts';
import { sha256Hex } from '../../../lib/digest.ts';
import type { Example, Explanation } from '../domain/explanation.ts';
import type { PartOfSpeech, TargetRange } from '../domain/lookup-entry.ts';
import { examples, lookupEntries } from './schema.ts';

export type ExampleView = {
  id: string;
  position: number;
  text: string;
  targetRanges: TargetRange[];
};

/** A lookup as the endpoints answer it, without the card saved from it. */
export type LookupView = {
  id: string;
  selectedText: string;
  lemma: string;
  pos: PartOfSpeech;
  meaningZh: string;
  examples: ExampleView[];
};

/** A normalized context with the selection's place in it. */
export type CacheKey = {
  ownerId: string;
  contextText: string;
  selection: { start: number; end: number };
};

const exampleView = {
  id: examples.id,
  position: examples.position,
  text: examples.text,
  targetRanges: examples.targetRanges,
};

function keyMatches(key: CacheKey) {
  return and(
    eq(lookupEntries.ownerId, key.ownerId),
    eq(lookupEntries.contextHash, sha256Hex(key.contextText)),
    eq(lookupEntries.selectionStart, key.selection.start),
    eq(lookupEntries.selectionEnd, key.selection.end),
    eq(lookupEntries.contextText, key.contextText),
  );
}

/** The ID of the member's cached lookup of this selection, or undefined. */
export async function findCachedLookup(
  executor: Executor,
  key: CacheKey,
): Promise<string | undefined> {
  const [row] = await executor
    .select({ id: lookupEntries.id })
    .from(lookupEntries)
    .where(keyMatches(key));
  return row?.id;
}

/** The examples of a lookup in position order. */
export function lookupExamples(executor: Executor, lookupId: string): Promise<ExampleView[]> {
  return executor
    .select(exampleView)
    .from(examples)
    .where(eq(examples.lookupEntryId, lookupId))
    .orderBy(asc(examples.position));
}

/** The member's lookup with its examples, or undefined when the member has no such lookup. */
export async function readLookup(
  executor: Executor,
  ownerId: string,
  lookupId: string,
): Promise<LookupView | undefined> {
  const [entry] = await executor
    .select({
      id: lookupEntries.id,
      selectedText: lookupEntries.selectedText,
      lemma: lookupEntries.lemma,
      pos: lookupEntries.pos,
      meaningZh: lookupEntries.meaningZh,
    })
    .from(lookupEntries)
    .where(and(eq(lookupEntries.id, lookupId), eq(lookupEntries.ownerId, ownerId)));
  return entry && { ...entry, examples: await lookupExamples(executor, lookupId) };
}

function exampleRow(lookupEntryId: string, position: number, example: Example) {
  return {
    lookupEntryId,
    position,
    text: example.text,
    targetRanges: example.targetRanges,
    contentHash: sha256Hex(example.text),
  };
}

/**
 * Stores an explanation under its key and returns the entry's ID and whether it is new. When
 * another request stored the same key first, that entry is kept and its ID returned.
 */
export async function storeLookup(
  tx: Transaction,
  key: CacheKey,
  explanation: Explanation,
): Promise<{ id: string; created: boolean }> {
  const [inserted] = await tx
    .insert(lookupEntries)
    .values({
      ownerId: key.ownerId,
      contextText: key.contextText,
      contextHash: sha256Hex(key.contextText),
      selectionStart: key.selection.start,
      selectionEnd: key.selection.end,
      selectedText: key.contextText.slice(key.selection.start, key.selection.end),
      lemma: explanation.lemma,
      lemmaKey: explanation.lemmaKey,
      pos: explanation.pos as PartOfSpeech,
      meaningZh: explanation.meaningZh,
      acceptedForms: explanation.acceptedForms,
    })
    .onConflictDoNothing()
    .returning({ id: lookupEntries.id });
  if (inserted) {
    await tx
      .insert(examples)
      .values(
        explanation.examples.map((example, position) => exampleRow(inserted.id, position, example)),
      );
    return { id: inserted.id, created: true };
  }
  const existing = await findCachedLookup(tx, key);
  if (!existing) {
    throw new Error('A lookup with the same key but another context is already stored.');
  }
  return { id: existing, created: false };
}

/** What a new example is written from: the lookup's meaning, its context and its examples. */
export type RefreshSource = {
  lemma: string;
  pos: PartOfSpeech;
  meaningZh: string;
  acceptedForms: string[];
  contextText: string;
  examples: ExampleView[];
};

/** The member's lookup a new example is written for, or undefined when there is none. */
export async function refreshSource(
  executor: Executor,
  ownerId: string,
  lookupId: string,
): Promise<RefreshSource | undefined> {
  const [entry] = await executor
    .select({
      lemma: lookupEntries.lemma,
      pos: lookupEntries.pos,
      meaningZh: lookupEntries.meaningZh,
      acceptedForms: lookupEntries.acceptedForms,
      contextText: lookupEntries.contextText,
    })
    .from(lookupEntries)
    .where(and(eq(lookupEntries.id, lookupId), eq(lookupEntries.ownerId, ownerId)));
  return entry && { ...entry, examples: await lookupExamples(executor, lookupId) };
}

const replaced = () =>
  new ApiError('CONFLICT', 'The example was replaced or its lookup changed meanwhile.');

/**
 * Puts the new example in the old one's position, with a new ID. The lookup's row is held until
 * the transaction ends, so refreshes of the same lookup take turns; an example that is gone by
 * now, or a new example another refresh already added, is a CONFLICT.
 */
export async function replaceExample(
  tx: Transaction,
  ownerId: string,
  lookupId: string,
  exampleId: string,
  example: Example,
): Promise<ExampleView> {
  const [entry] = await tx
    .select({ id: lookupEntries.id })
    .from(lookupEntries)
    .where(and(eq(lookupEntries.id, lookupId), eq(lookupEntries.ownerId, ownerId)))
    .for('update');
  if (!entry) {
    throw new ApiError('NOT_FOUND', 'The lookup was not found.');
  }
  const [old] = await tx
    .delete(examples)
    .where(and(eq(examples.id, exampleId), eq(examples.lookupEntryId, lookupId)))
    .returning({ position: examples.position });
  if (!old) {
    throw replaced();
  }
  const row = exampleRow(lookupId, old.position, example);
  const [same] = await tx
    .select({ id: examples.id })
    .from(examples)
    .where(
      and(
        eq(examples.lookupEntryId, lookupId),
        eq(examples.contentHash, row.contentHash),
        ne(examples.position, old.position),
      ),
    );
  if (same) {
    throw replaced();
  }
  const [inserted] = await tx.insert(examples).values(row).returning(exampleView);
  return inserted;
}
