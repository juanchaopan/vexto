// The requests of the vocabulary endpoints (.docs/design/interfaces.md, 生词本): the list's query
// string, the bodies of the writes and the IDs in the paths. A query-string name the list does
// not take, a value given twice where one is allowed, or a round that is not a choice is invalid
// input; a path ID that is not a UUID names no card.
import { z } from 'zod';
import { ApiError } from '../../../lib/api/errors.ts';
import { parseInput } from '../../../lib/api/route.ts';
import { SELECTION_MAX } from '../domain/save-decision.ts';
import { REVIEW_MODES, type ReviewMode } from '../domain/review-progress.ts';
import {
  DEFAULT_VOCABULARY_QUERY,
  effectiveRounds,
  ROUND_CHOICES,
  SORT_DIRECTIONS,
  VOCABULARY_SEARCH_MAX_LENGTH,
  VOCABULARY_SORTS,
  VOCABULARY_STATES,
  type VocabularyQuery,
} from '../domain/vocabulary-query.ts';

const roundParam = (mode: ReviewMode) => `rounds.${mode}`;

const repeatable = new Set<string>(REVIEW_MODES.map(roundParam));

// PostgreSQL text cannot hold a NUL character, so a search with one is refused here.
const searchText = z
  .string()
  .max(VOCABULARY_SEARCH_MAX_LENGTH)
  .refine((text) => !text.includes('\u0000'), 'must not contain a NUL character');

const rounds = z.array(z.enum(ROUND_CHOICES));

const listParams = z.strictObject({
  state: z.enum(VOCABULARY_STATES).optional(),
  q: searchText.optional(),
  'rounds.speak': rounds,
  'rounds.spell': rounds,
  'rounds.translate': rounds,
  sort: z.enum(VOCABULARY_SORTS).optional(),
  direction: z.enum(SORT_DIRECTIONS).optional(),
  cursor: z.string().max(2000).optional(),
});

/** The parameters as an object: the round filters as arrays, the others as single strings. */
function paramObject(params: URLSearchParams): Record<string, unknown> {
  const object: Record<string, unknown> = Object.fromEntries(
    REVIEW_MODES.map((mode) => [roundParam(mode), []]),
  );
  for (const name of new Set(params.keys())) {
    const values = params.getAll(name);
    if (repeatable.has(name)) {
      object[name] = values;
    } else if (values.length > 1) {
      throw new ApiError('INVALID_INPUT', `The parameter ${name} is given more than once.`);
    } else {
      object[name] = values[0];
    }
  }
  return object;
}

/** The query and cursor of a list request. */
export function vocabularyListRequest(params: URLSearchParams): {
  query: VocabularyQuery;
  cursor: string | undefined;
} {
  const fields = parseInput(listParams, paramObject(params));
  return {
    query: {
      state: fields.state ?? DEFAULT_VOCABULARY_QUERY.state,
      q: fields.q?.trim() ?? DEFAULT_VOCABULARY_QUERY.q,
      rounds: {
        speak: effectiveRounds(fields['rounds.speak']),
        spell: effectiveRounds(fields['rounds.spell']),
        translate: effectiveRounds(fields['rounds.translate']),
      },
      sort: fields.sort ?? DEFAULT_VOCABULARY_QUERY.sort,
      direction: fields.direction ?? DEFAULT_VOCABULARY_QUERY.direction,
    },
    cursor: fields.cursor,
  };
}

const id = z.uuid();

export const saveRequest = z.strictObject({ operationId: id, lookupId: id });

export const replaceRequest = z.strictObject({
  operationId: id,
  lookupId: id,
  updatedAt: z.iso.datetime({ offset: true }),
});

/** The body of a refresh or a single delete: the operation only. */
export const operationRequest = z.strictObject({ operationId: id });

export const bulkDeleteRequest = z.strictObject({
  operationId: id,
  ids: z
    .array(id)
    .min(1)
    .max(SELECTION_MAX)
    .refine((ids) => new Set(ids.map((one) => one.toLowerCase())).size === ids.length, {
      message: 'must not repeat an ID',
    }),
});

const notFound = () => new ApiError('NOT_FOUND', 'The card was not found.');

/** The card ID of a path. */
export function cardPathId(cardId: string): string {
  if (!id.safeParse(cardId).success) {
    throw notFound();
  }
  return cardId.toLowerCase();
}

/** The card and example IDs of an example refresh path. */
export function cardExamplePath(params: { id: string; exampleId: string }): {
  cardId: string;
  exampleId: string;
} {
  if (!id.safeParse(params.exampleId).success) {
    throw notFound();
  }
  return { cardId: cardPathId(params.id), exampleId: params.exampleId.toLowerCase() };
}
