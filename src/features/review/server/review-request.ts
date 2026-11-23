// The requests of the review endpoints (.docs/design/interfaces.md, 复习): the mode of
// `GET /api/review/next` and the body of `POST /api/review/submit`. Only Spell and Translate have
// questions in this version, so any other mode is invalid input. A Spell answer is text of at
// most 80 characters with something in it; a Translate answer names an option by its ID. A body
// with a field the endpoint does not take, such as a round, is invalid input as well.
import { z } from 'zod';
import { databaseText, parseInput, queryObject } from '../../../lib/api/route.ts';
import { REVIEWABLE_MODES, type ReviewableMode } from '../domain/schedule.ts';
import { SPELL_ANSWER_MAX_LENGTH } from '../domain/spelling.ts';

const id = z.uuid();

const modeParams = z.strictObject({ mode: z.enum(REVIEWABLE_MODES) });

/** The mode of a next-question request; anything but one `mode` parameter is invalid input. */
export function nextQuestionRequest(params: URLSearchParams): ReviewableMode {
  return parseInput(modeParams, queryObject(params)).mode;
}

// An answer of only spaces is no answer.
const spelling = databaseText(SPELL_ANSWER_MAX_LENGTH).refine(
  (text) => text.trim() !== '',
  'must not be empty',
);

export const submitRequest = z.discriminatedUnion('mode', [
  z.strictObject({
    operationId: id,
    cardId: id,
    mode: z.literal('spell'),
    answer: z.strictObject({ text: spelling }),
  }),
  z.strictObject({
    operationId: id,
    cardId: id,
    mode: z.literal('translate'),
    answer: z.strictObject({ optionId: id }),
  }),
]);

export type SubmitRequest = z.infer<typeof submitRequest>;
