// The vocabulary endpoints (.docs/design/interfaces.md, 生词本): the list, one card, saving an
// explanation, replacing a saved card, refreshing one of a card's examples, and deleting one or a
// batch of cards. The writes carry an operationId: a repeated request gets the first answer
// without calling the AI again. The AI is called outside any transaction; the writes and the
// receipt go in one transaction afterwards, which holds the member's row (or the card's, for an
// example) and checks again that what the calls were made for still stands.
import { randomInt, randomUUID } from 'node:crypto';
import { ApiError } from '../../../lib/api/errors.ts';
import {
  dataResult,
  listResult,
  noContentResult,
  type ApiResult,
} from '../../../lib/api/responses.ts';
import { getDatabase, inTransaction, type Transaction } from '../../../lib/db/client.ts';
import {
  findOperationResult,
  runOperation,
  type Operation,
} from '../../../lib/db/operation-receipts.ts';
import {
  exampleTask,
  modelServices,
  runModelTask,
  type ModelServices,
  type RequestMember,
} from '../../lookup/index.ts';
import {
  decisionOf,
  missingIds,
  sameCards,
  type CardStamp,
  type SaveDecision,
} from '../domain/save-decision.ts';
import { translationSet, type TranslationRandom } from '../domain/translation-set.ts';
import { savedCardIdOf } from './card-sources.ts';
import { listCards } from './card-list.ts';
import {
  cardHeadOf,
  cardMeanings,
  cardSourceOf,
  deleteCards,
  insertCard,
  lockMember,
  ownCardIds,
  readCard,
  replaceCardContent,
  replaceCardExample,
  sameWordCards,
  savedCardOf,
  type CardSource,
} from './card-store.ts';
import { vocabularyListRequest } from './vocabulary-request.ts';
import { meaningMatchTask, translationTask } from './vocabulary-tasks.ts';

export type VocabularyDependencies = {
  /** The AI client and parameters, made only when a call is needed. */
  model?: () => ModelServices;
  /** Where the Translate options' IDs and order come from. */
  random?: TranslationRandom;
};

const cryptoRandom: TranslationRandom = {
  id: () => randomUUID(),
  index: (below) => randomInt(below),
};

const cardNotFound = () => new ApiError('NOT_FOUND', 'The card was not found.');
const lookupNotFound = () => new ApiError('NOT_FOUND', 'The lookup was not found.');

/** `GET /api/vocabulary`: one batch with the cursor of the next and the total count. */
export async function vocabularyListResult(
  ownerId: string,
  params: URLSearchParams,
  executor = getDatabase(),
): Promise<ApiResult> {
  const { query, cursor } = vocabularyListRequest(params);
  const batch = await listCards(executor, ownerId, query, cursor);
  return listResult(batch.items, { nextCursor: batch.nextCursor, totalCount: batch.totalCount });
}

/** `GET /api/vocabulary/:id`: the card with its progress and examples. */
export async function cardResult(
  ownerId: string,
  cardId: string,
  executor = getDatabase(),
): Promise<ApiResult> {
  const card = await readCard(executor, ownerId, cardId);
  if (!card) {
    throw cardNotFound();
  }
  return dataResult(card);
}

async function duplicateOf(tx: Transaction, ownerId: string, cardId: string): Promise<never> {
  const card = await readCard(tx, ownerId, cardId);
  if (!card) {
    throw new Error('A card that was just found could not be read.');
  }
  throw new ApiError('DUPLICATE_WORD', 'This word is already saved.', {
    savedCard: savedCardOf(card),
  });
}

/** What the reads and AI calls before a save's transaction decided. */
type SavePlan = {
  /** The card already saved from this lookup, or null. */
  fromLookup: string | null;
  /** The cards of the same lemma and part of speech the decision was made on. */
  candidates: CardStamp[];
  decision: SaveDecision;
  /** The wrong Translate options, written when the decision is a new card. */
  distractors: string[];
};

const examplesOf = (source: CardSource) => source.examples.map((example) => example.text);

async function planSave(
  ownerId: string,
  lookupId: string,
  model: () => ModelServices,
): Promise<SavePlan> {
  const database = getDatabase();
  const source = await cardSourceOf(database, ownerId, lookupId);
  if (!source) {
    throw lookupNotFound();
  }
  const fromLookup = await savedCardIdOf(database, ownerId, lookupId);
  if (fromLookup) {
    return {
      fromLookup,
      candidates: [],
      decision: { kind: 'duplicate', cardId: fromLookup },
      distractors: [],
    };
  }
  const candidates = await sameWordCards(database, ownerId, source);
  const meaning = { meaningZh: source.meaningZh, examples: examplesOf(source) };
  let decision: SaveDecision = { kind: 'create' };
  if (candidates.length > 0) {
    const savedMeanings = await cardMeanings(
      database,
      ownerId,
      candidates.map((card) => card.id),
    );
    const sameMeaning = await runModelTask(
      model(),
      meaningMatchTask({
        ownerId,
        lookupId,
        lemma: source.lemma,
        pos: source.pos,
        meaning,
        savedMeanings,
      }),
    );
    decision = decisionOf(candidates, sameMeaning);
  }
  const distractors =
    decision.kind === 'create'
      ? await runModelTask(
          model(),
          translationTask({
            ownerId,
            resource: { type: 'lookup', id: lookupId },
            lemma: source.lemma,
            pos: source.pos,
            meaning,
          }),
        )
      : [];
  return { fromLookup: null, candidates, decision, distractors };
}

/** Thrown inside a save's transaction when the cards changed after the decision was made. */
class PlanOutdated extends Error {}

function saveWrites(
  ownerId: string,
  lookupId: string,
  plan: SavePlan,
  final: boolean,
  random: TranslationRandom,
) {
  return async (tx: Transaction): Promise<ApiResult> => {
    await lockMember(tx, ownerId);
    const source = await cardSourceOf(tx, ownerId, lookupId);
    if (!source) {
      throw lookupNotFound();
    }
    const fromLookup = await savedCardIdOf(tx, ownerId, lookupId);
    if (fromLookup) {
      return duplicateOf(tx, ownerId, fromLookup);
    }
    const candidates = await sameWordCards(tx, ownerId, source);
    if (plan.fromLookup !== null || !sameCards(plan.candidates, candidates)) {
      if (final) {
        throw new ApiError('CONFLICT', 'The saved words changed while this one was being saved.');
      }
      throw new PlanOutdated();
    }
    if (plan.decision.kind === 'duplicate') {
      return duplicateOf(tx, ownerId, plan.decision.cardId);
    }
    const options = translationSet(source, plan.distractors, random);
    const cardId = await insertCard(tx, ownerId, source, options);
    return dataResult(await readCard(tx, ownerId, cardId), 201);
  };
}

export type SaveTarget = { lookupId: string; operationId: string };

/**
 * `POST /api/vocabulary` for the member. When the cards change between the decision and the
 * writes, the save is decided once more from the start; a second change is a CONFLICT.
 */
export async function saveCardResult(
  member: RequestMember,
  target: SaveTarget,
  { model = modelServices, random = cryptoRandom }: VocabularyDependencies = {},
): Promise<ApiResult> {
  const { ownerId, requestId } = member;
  const operation: Operation = {
    ownerId,
    operationId: target.operationId,
    kind: 'vocabulary.save',
    request: { lookupId: target.lookupId },
  };
  const replayed = await findOperationResult(getDatabase(), operation);
  if (replayed) {
    return replayed;
  }
  for (let attempt = 0; ; attempt += 1) {
    const plan = await planSave(ownerId, target.lookupId, model);
    try {
      return await inTransaction((tx) =>
        runOperation(
          tx,
          { ...operation, requestId },
          saveWrites(ownerId, target.lookupId, plan, attempt > 0, random),
        ),
      );
    } catch (error) {
      if (!(error instanceof PlanOutdated) || attempt > 0) {
        throw error;
      }
    }
  }
}

function sameWord(card: { lemmaKey: string; pos: string }, source: CardSource): boolean {
  return card.lemmaKey === source.lemmaKey && card.pos === source.pos;
}

const otherWord = () =>
  new ApiError('INVALID_INPUT', 'The lookup has another lemma or part of speech than the card.');
const changedCard = () => new ApiError('CONFLICT', 'The card changed after it was shown.');

export type ReplaceTarget = {
  cardId: string;
  lookupId: string;
  updatedAt: string;
  operationId: string;
};

const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/** `POST /api/vocabulary/:id/replace` for the member; the review progress stays as it is. */
export async function replaceCardResult(
  member: RequestMember,
  target: ReplaceTarget,
  { model = modelServices, random = cryptoRandom }: VocabularyDependencies = {},
): Promise<ApiResult> {
  const { ownerId, requestId } = member;
  const database = getDatabase();
  const operation: Operation = {
    ownerId,
    operationId: target.operationId,
    kind: 'vocabulary.replace',
    request: { cardId: target.cardId, lookupId: target.lookupId, updatedAt: target.updatedAt },
  };
  const replayed = await findOperationResult(database, operation);
  if (replayed) {
    return replayed;
  }
  const card = await cardHeadOf(database, ownerId, target.cardId);
  if (!card) {
    throw cardNotFound();
  }
  const source = await cardSourceOf(database, ownerId, target.lookupId);
  if (!source) {
    throw lookupNotFound();
  }
  if (!sameTime(card.updatedAt, target.updatedAt)) {
    throw changedCard();
  }
  if (!sameWord(card, source)) {
    throw otherWord();
  }
  const distractors = await runModelTask(
    model(),
    translationTask({
      ownerId,
      resource: { type: 'card', id: target.cardId },
      lemma: source.lemma,
      pos: source.pos,
      meaning: { meaningZh: source.meaningZh, examples: examplesOf(source) },
    }),
  );
  return inTransaction((tx) =>
    runOperation(tx, { ...operation, requestId }, async (work) => {
      await lockMember(work, ownerId);
      const current = await cardHeadOf(work, ownerId, target.cardId, true);
      if (!current) {
        throw cardNotFound();
      }
      if (!sameTime(current.updatedAt, target.updatedAt)) {
        throw changedCard();
      }
      const latest = await cardSourceOf(work, ownerId, target.lookupId);
      if (!latest) {
        throw lookupNotFound();
      }
      if (!sameWord(current, latest)) {
        throw otherWord();
      }
      await replaceCardContent(
        work,
        target.cardId,
        latest,
        translationSet(latest, distractors, random),
      );
      return dataResult(await readCard(work, ownerId, target.cardId));
    }),
  );
}

export type CardExampleTarget = { cardId: string; exampleId: string; operationId: string };

/** `POST /api/vocabulary/:id/examples/:exampleId/refresh` for the member. */
export async function refreshCardExampleResult(
  member: RequestMember,
  target: CardExampleTarget,
  { model = modelServices }: Pick<VocabularyDependencies, 'model'> = {},
): Promise<ApiResult> {
  const { ownerId, requestId } = member;
  const database = getDatabase();
  const operation: Operation = {
    ownerId,
    operationId: target.operationId,
    kind: 'vocabulary.refresh-example',
    request: { cardId: target.cardId, exampleId: target.exampleId },
  };
  const replayed = await findOperationResult(database, operation);
  if (replayed) {
    return replayed;
  }
  const card = await cardHeadOf(database, ownerId, target.cardId);
  const view = card && (await readCard(database, ownerId, target.cardId));
  if (!card || !view) {
    throw cardNotFound();
  }
  const shown = view.examples.find((example) => example.id === target.exampleId);
  if (!shown) {
    throw new ApiError('CONFLICT', 'The example was already replaced.');
  }
  const task = exampleTask({
    ownerId,
    lookupId: target.cardId,
    lemma: card.lemma,
    pos: card.pos,
    meaningZh: card.meaningZh,
    acceptedForms: card.acceptedForms,
    // A card keeps no passage of its own; the example being replaced sets the level instead.
    context: shown.text,
    existingExamples: view.examples.map((example) => example.text),
  });
  const example = await runModelTask(model(), {
    ...task,
    usage: { ...task.usage, resourceType: 'card', resourceId: target.cardId },
  });
  return inTransaction((tx) =>
    runOperation(tx, { ...operation, requestId }, async (work) => {
      if (!(await cardHeadOf(work, ownerId, target.cardId, true))) {
        throw cardNotFound();
      }
      return dataResult(await replaceCardExample(work, target.cardId, target.exampleId, example));
    }),
  );
}

export type DeleteTarget = { cardId: string; operationId: string };

/** `DELETE /api/vocabulary/:id` for the member. */
export async function deleteCardResult(
  member: RequestMember,
  target: DeleteTarget,
): Promise<ApiResult> {
  const { ownerId, requestId } = member;
  const operation: Operation = {
    ownerId,
    operationId: target.operationId,
    kind: 'vocabulary.delete',
    request: { cardId: target.cardId },
  };
  return inTransaction((tx) =>
    runOperation(tx, { ...operation, requestId }, async (work) => {
      await lockMember(work, ownerId);
      const deleted = await deleteCards(work, ownerId, [target.cardId]);
      if (deleted.length === 0) {
        throw cardNotFound();
      }
      return noContentResult();
    }),
  );
}

export type BulkDeleteTarget = { ids: readonly string[]; operationId: string };

/**
 * `POST /api/vocabulary/bulk-delete` for the member: every card or none. A card that is gone, or
 * is not the member's, makes the whole batch SELECTION_CHANGED.
 */
export async function bulkDeleteResult(
  member: RequestMember,
  target: BulkDeleteTarget,
): Promise<ApiResult> {
  const { ownerId, requestId } = member;
  const ids = target.ids.map((id) => id.toLowerCase());
  const operation: Operation = {
    ownerId,
    operationId: target.operationId,
    kind: 'vocabulary.bulk-delete',
    request: { ids: [...ids].sort() },
  };
  return inTransaction((tx) =>
    runOperation(tx, { ...operation, requestId }, async (work) => {
      await lockMember(work, ownerId);
      const missing = missingIds(ids, await ownCardIds(work, ownerId, ids));
      if (missing.length > 0) {
        throw new ApiError('SELECTION_CHANGED', 'Some of the selected cards no longer exist.', {
          missingIds: missing,
        });
      }
      await deleteCards(work, ownerId, ids);
      return noContentResult();
    }),
  );
}
