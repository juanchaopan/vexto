// The review endpoints (.docs/design/interfaces.md, 复习): the counts, the next question of a
// mode and submitting an answer.
//
// The next question is read in one read-only snapshot, so the card chosen is the card shown even
// while another device deletes or answers it. Submitting runs in one transaction with its
// operation receipt: it locks the progress row of the card's mode, checks with the database's
// time that the question is still open (a new word, or due and not complete), judges the answer
// against the card as it is now and moves the round and due time on. Two different submits of
// the same question take turns on the lock; the later one finds the question no longer due and
// gets CONFLICT, so a round is never moved twice. A repeated submit with the same operationId
// gets the first answer again. Nothing here calls the AI or the speech service.
import { ApiError } from '../../../lib/api/errors.ts';
import { dataResult, type ApiResult } from '../../../lib/api/responses.ts';
import { getDatabase, inTransaction, type Transaction } from '../../../lib/db/client.ts';
import { runOperation, type Operation } from '../../../lib/db/operation-receipts.ts';
import type { RequestMember } from '../../lookup/index.ts';
import { dueAfter, isAnswerable, stepAfter, type ReviewableMode } from '../domain/schedule.ts';
import { isAcceptedSpelling } from '../domain/spelling.ts';
import {
  holdProgress,
  moveProgress,
  nextCardId,
  nextDueAt,
  questionCard,
  reviewCounts,
  translationOptions,
} from './review-queries.ts';
import { questionOf } from './review-questions.ts';
import { nextQuestionRequest, type SubmitRequest } from './review-request.ts';

const cardNotFound = () => new ApiError('NOT_FOUND', 'The card was not found.');
const closedQuestion = () =>
  new ApiError('CONFLICT', 'The question is not due, is complete or was answered elsewhere.');
const changedOptions = () =>
  new ApiError('CONFLICT', 'The card has other options than the question that was shown.');

/** `GET /api/review/counts`: due and new questions of Spell and Translate. */
export async function reviewCountsResult(
  ownerId: string,
  executor = getDatabase(),
): Promise<ApiResult> {
  return dataResult(await reviewCounts(executor, ownerId));
}

/** `GET /api/review/next`: the mode's next question, or none and when the next falls due. */
export async function nextQuestionResult(
  ownerId: string,
  params: URLSearchParams,
): Promise<ApiResult> {
  const mode = nextQuestionRequest(params);
  return getDatabase().transaction(
    async (tx) => {
      const cardId = await nextCardId(tx, ownerId, mode);
      const question = cardId ? await questionOf(tx, ownerId, cardId, mode) : undefined;
      if (question) {
        return dataResult({ question, nextDueAt: null });
      }
      const dueAt = await nextDueAt(tx, ownerId, mode);
      return dataResult({ question: null, nextDueAt: dueAt?.toISOString() ?? null });
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

type Verdict = { correct: boolean; answer: string };

async function judgeSpelling(
  tx: Transaction,
  ownerId: string,
  cardId: string,
  text: string,
): Promise<Verdict> {
  const card = await questionCard(tx, ownerId, cardId);
  if (!card) {
    throw cardNotFound();
  }
  return { correct: isAcceptedSpelling(text, card.acceptedForms), answer: card.lemma };
}

/**
 * Judges a chosen option. An option the card does not have is one of a question shown before the
 * card was replaced, whose options are new, so the card changed meanwhile.
 */
async function judgeChoice(tx: Transaction, cardId: string, optionId: string): Promise<Verdict> {
  const set = await translationOptions(tx, cardId);
  const right = set?.options.find((option) => option.id === set.correctOptionId);
  if (!set || !right) {
    throw cardNotFound();
  }
  if (!set.options.some((option) => option.id === optionId)) {
    throw changedOptions();
  }
  return { correct: optionId === right.id, answer: right.meaningZh };
}

function judge(tx: Transaction, ownerId: string, body: SubmitRequest): Promise<Verdict> {
  return body.mode === 'spell'
    ? judgeSpelling(tx, ownerId, body.cardId, body.answer.text)
    : judgeChoice(tx, body.cardId, body.answer.optionId.toLowerCase());
}

async function answerQuestion(
  tx: Transaction,
  ownerId: string,
  body: SubmitRequest,
): Promise<ApiResult> {
  const mode: ReviewableMode = body.mode;
  const progress = await holdProgress(tx, ownerId, body.cardId, mode);
  if (!progress) {
    throw cardNotFound();
  }
  if (!isAnswerable(progress, progress.now)) {
    throw closedQuestion();
  }
  const verdict = await judge(tx, ownerId, body);
  const step = stepAfter(progress.round, verdict.correct);
  const dueAt = dueAfter(progress.now, step.wait);
  await moveProgress(tx, ownerId, body.cardId, mode, { round: step.round, dueAt });
  return dataResult({
    result: verdict.correct ? 'correct' : 'incorrect',
    answer: verdict.answer,
    round: step.round,
    dueAt: dueAt?.toISOString() ?? null,
  });
}

/** `POST /api/review/submit` for the member. */
export function submitAnswerResult(member: RequestMember, body: SubmitRequest): Promise<ApiResult> {
  const { ownerId, requestId } = member;
  const operation: Operation = {
    ownerId,
    operationId: body.operationId,
    kind: 'review.submit',
    request: { cardId: body.cardId.toLowerCase(), mode: body.mode, answer: body.answer },
  };
  return inTransaction((tx) =>
    runOperation(tx, { ...operation, requestId }, (work) => answerQuestion(work, ownerId, body)),
  );
}
