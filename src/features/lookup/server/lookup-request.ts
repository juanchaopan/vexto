// The bodies of the lookup endpoints (.docs/design/interfaces.md, 查词): a lookup names its
// context by IDs and sentence numbers only, never by text, and the selection by its place in the
// context text. Every object is strict, so a field another kind uses, or any text, is invalid.
// An article context may span only as many sentences as a selection of the most words can touch.
import { z } from 'zod';
import { ApiError } from '../../../lib/api/errors.ts';
import { SELECTION_MAX_WORDS } from '../domain/selection.ts';

const id = z.uuid();
const sentence = z.number().int().min(0).max(100_000);
const offset = z.number().int().min(0).max(1_000_000);

const articleContext = z
  .strictObject({
    kind: z.literal('article'),
    articleId: id,
    firstSentence: sentence,
    lastSentence: sentence,
  })
  .refine(
    (context) =>
      context.firstSentence <= context.lastSentence &&
      context.lastSentence - context.firstSentence < SELECTION_MAX_WORDS,
    { message: 'must name a short run of sentences in order', path: ['lastSentence'] },
  );

export const lookupContextRequest = z.discriminatedUnion('kind', [
  articleContext,
  z.strictObject({ kind: z.literal('lookup-example'), lookupId: id, exampleId: id }),
  z.strictObject({ kind: z.literal('vocabulary-example'), cardId: id, exampleId: id }),
  z.strictObject({ kind: z.literal('spell-example'), cardId: id, exampleId: id }),
]);

export type LookupContextLocator = z.infer<typeof lookupContextRequest>;

export const lookupRequest = z.strictObject({
  operationId: id,
  context: lookupContextRequest,
  selection: z.strictObject({ start: offset, end: offset }),
});

export type LookupRequest = z.infer<typeof lookupRequest>;

export const refreshExampleRequest = z.strictObject({ operationId: id });

const refreshParams = z.object({ id, exampleId: id });

/** The lookup and example IDs of a refresh path; an ID that is not a UUID names nothing. */
export function refreshPath(params: { id: string; exampleId: string }): {
  lookupId: string;
  exampleId: string;
} {
  const parsed = refreshParams.safeParse(params);
  if (!parsed.success) {
    throw new ApiError('NOT_FOUND', 'The lookup was not found.');
  }
  return { lookupId: parsed.data.id, exampleId: parsed.data.exampleId };
}
