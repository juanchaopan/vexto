// The browser side of the lookup endpoints (.docs/design/interfaces.md, 查词): asking for an
// explanation of a selection in its context, and for a new example in place of one. Each request
// carries the operationId of the person's action; Retry sends the same one again.
import { z } from 'zod';
import { apiRequest, dataBody } from '../../../lib/api/client.ts';
import type { LookupContext } from '../../../lib/ui/lookup-bridge.ts';
import type { TextRange } from '../domain/selection.ts';

const exampleSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  text: z.string(),
  targetRanges: z.array(z.tuple([z.number().int(), z.number().int()])),
});

export type LookupExample = z.infer<typeof exampleSchema>;

const lookupSchema = z.object({
  id: z.string(),
  selectedText: z.string(),
  lemma: z.string(),
  pos: z.string(),
  meaningZh: z.string(),
  examples: z.array(exampleSchema),
  savedCardId: z.string().nullable(),
});

export type LookupResult = z.infer<typeof lookupSchema>;

/** `POST /api/lookups`: the explanation of the selection, from the cache or the AI. */
export async function requestLookup(
  context: LookupContext,
  selection: TextRange,
  operationId: string,
): Promise<LookupResult> {
  const { data } = await apiRequest('/api/lookups', dataBody(lookupSchema), {
    method: 'POST',
    body: { operationId, context, selection },
  });
  return data;
}

/** `POST /api/lookups/:id/examples/:exampleId/refresh`: a new example in the old one's place. */
export async function requestNewExample(
  lookupId: string,
  exampleId: string,
  operationId: string,
): Promise<LookupExample> {
  const path = `/api/lookups/${encodeURIComponent(lookupId)}/examples/${encodeURIComponent(exampleId)}/refresh`;
  const { data } = await apiRequest(path, dataBody(exampleSchema), {
    method: 'POST',
    body: { operationId },
  });
  return data;
}
