// The lookup endpoints (.docs/design/interfaces.md, 查词):
//   - `POST /api/lookups` explains a selection of a context. The server rebuilds the context from
//     its IDs, grows the selection to whole words, checks the 8-word and 80-character limit and,
//     for a Spell example, the hidden word; then answers from the member's cache (200) or asks the
//     AI and keeps the answer (201).
//   - `POST /api/lookups/:id/examples/:exampleId/refresh` replaces one example of a lookup with a
//     new one at the same position; the meaning stays.
// Both carry an operationId: a repeated request gets the first answer without calling the AI
// again. The AI is called outside any transaction; the writes and the receipt go in one
// transaction afterwards, which checks again that what the call was for still stands.
import { ApiError } from '../../../lib/api/errors.ts';
import { dataResult, type ApiResult } from '../../../lib/api/responses.ts';
import {
  getDatabase,
  inTransaction,
  type Executor,
  type Transaction,
} from '../../../lib/db/client.ts';
import {
  findOperationResult,
  runOperation,
  type Operation,
} from '../../../lib/db/operation-receipts.ts';
import type { Explanation } from '../domain/explanation.ts';
import {
  isRangeOf,
  normalizeContext,
  overlapsAny,
  selectionExtent,
  selectionProblem,
  type TextRange,
} from '../domain/selection.ts';
import { exampleTask, explanationTask } from './explanation-tasks.ts';
import { lookupContextText, type CardSources, type LookupContextText } from './lookup-context.ts';
import type { LookupRequest } from './lookup-request.ts';
import {
  findCachedLookup,
  readLookup,
  refreshSource,
  replaceExample,
  storeLookup,
  type CacheKey,
} from './lookup-store.ts';
import { modelServices, runModelTask, type ModelServices } from './model-call.ts';

export type LookupDependencies = {
  /** The vocabulary cards' part: card examples as contexts and the card saved from a lookup. */
  cards: CardSources;
  /** The AI client and parameters, made only when a call is needed. */
  model?: () => ModelServices;
};

/** Who asks: the member and the request's ID, which a stored error answer carries. */
export type RequestMember = { requestId: string; ownerId: string };

const invalid = (message: string) => new ApiError('INVALID_INPUT', message);

/** The selection grown to whole words and checked against the context and the limits. */
function checkedSelection(context: LookupContextText, selection: TextRange): TextRange {
  if (!isRangeOf(context.text, selection)) {
    throw invalid('The selection is not a range of the context.');
  }
  const extent = selectionExtent(context.text, selection);
  const problem = extent && selectionProblem(context.text.slice(extent.start, extent.end));
  if (!extent || problem === 'empty') {
    throw invalid('The selection holds no word.');
  }
  if (problem === 'too-long') {
    throw invalid('The selection has more than 8 words or 80 characters.');
  }
  if (overlapsAny(extent, context.hiddenRanges)) {
    throw new ApiError('HIDDEN_RANGE', 'The selection overlaps the hidden word.');
  }
  return extent;
}

async function lookupAnswer(
  executor: Executor,
  ownerId: string,
  lookupId: string,
  cards: CardSources,
  status: number,
): Promise<ApiResult> {
  const lookup = await readLookup(executor, ownerId, lookupId);
  if (!lookup) {
    throw new Error('A lookup that was just found or stored could not be read.');
  }
  const savedCardId = await cards.savedCardId(executor, ownerId, lookupId);
  return dataResult({ ...lookup, savedCardId }, status);
}

/** The writes of a lookup: none for a cached one, the explanation under its key for a new one. */
function answerFrom(
  key: CacheKey,
  found: { cached: string } | { explanation: Explanation },
  cards: CardSources,
) {
  return async (work: Transaction): Promise<ApiResult> => {
    if ('cached' in found) {
      return lookupAnswer(work, key.ownerId, found.cached, cards, 200);
    }
    const stored = await storeLookup(work, key, found.explanation);
    return lookupAnswer(work, key.ownerId, stored.id, cards, stored.created ? 201 : 200);
  };
}

/** `POST /api/lookups` for the member. */
export async function lookupResult(
  member: RequestMember,
  body: LookupRequest,
  { cards, model = modelServices }: LookupDependencies,
): Promise<ApiResult> {
  const { ownerId, requestId } = member;
  const database = getDatabase();
  const operation: Operation = {
    ownerId,
    operationId: body.operationId,
    kind: 'lookup.create',
    request: { context: body.context, selection: body.selection },
  };
  const replayed = await findOperationResult(database, operation);
  if (replayed) {
    return replayed;
  }
  const context = await lookupContextText(database, ownerId, body.context, cards);
  const normalized = normalizeContext(context.text, checkedSelection(context, body.selection));
  const key: CacheKey = { ownerId, contextText: normalized.text, selection: normalized.range };
  const cached = await findCachedLookup(database, key);
  const found = cached
    ? { cached }
    : {
        explanation: await runModelTask(
          model(),
          explanationTask({ ownerId, context: key.contextText, selection: key.selection }),
        ),
      };
  return inTransaction((tx) =>
    runOperation(tx, { ...operation, requestId }, answerFrom(key, found, cards)),
  );
}

export type RefreshTarget = { lookupId: string; exampleId: string; operationId: string };

/** `POST /api/lookups/:id/examples/:exampleId/refresh` for the member. */
export async function refreshExampleResult(
  member: RequestMember,
  target: RefreshTarget,
  { model = modelServices }: Pick<LookupDependencies, 'model'> = {},
): Promise<ApiResult> {
  const { ownerId, requestId } = member;
  const database = getDatabase();
  const operation: Operation = {
    ownerId,
    operationId: target.operationId,
    kind: 'lookup.refresh-example',
    request: { lookupId: target.lookupId, exampleId: target.exampleId },
  };
  const replayed = await findOperationResult(database, operation);
  if (replayed) {
    return replayed;
  }
  const source = await refreshSource(database, ownerId, target.lookupId);
  if (!source) {
    throw new ApiError('NOT_FOUND', 'The lookup was not found.');
  }
  if (!source.examples.some((example) => example.id === target.exampleId)) {
    throw new ApiError('CONFLICT', 'The example was already replaced.');
  }
  const example = await runModelTask(
    model(),
    exampleTask({
      ownerId,
      resource: { type: 'lookup', id: target.lookupId },
      lemma: source.lemma,
      pos: source.pos,
      meaningZh: source.meaningZh,
      acceptedForms: source.acceptedForms,
      context: source.contextText,
      existingExamples: source.examples.map((existing) => existing.text),
    }),
  );
  return inTransaction((tx) =>
    runOperation(tx, { ...operation, requestId }, async (work) =>
      dataResult(await replaceExample(work, ownerId, target.lookupId, target.exampleId, example)),
    ),
  );
}
