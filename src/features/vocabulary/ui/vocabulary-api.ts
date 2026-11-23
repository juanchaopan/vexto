'use client';

// The browser side of the vocabulary endpoints (.docs/design/interfaces.md, 生词本): the list in
// batches, one card, and the writes. A list keeps the batches it loaded and their order until its
// query changes or a write changes the vocabulary, so coming back to it shows the same cards.
// Every write carries the operationId of the person's action; Retry sends the same one again.
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, dataBody, isoTime, listBody } from '../../../lib/api/client.ts';
import { loadedItems } from '../../../lib/ui/batched-list.ts';
import { REVIEW_MODES } from '../domain/review-progress.ts';
import type { VocabularyQuery } from '../domain/vocabulary-query.ts';

const modeProgress = z.object({ round: z.number().int(), dueAt: isoTime.nullable() });

const progressSchema = z.object({
  speak: modeProgress,
  spell: modeProgress,
  translate: modeProgress,
});

const listItemSchema = z.object({
  id: z.string(),
  lemma: z.string(),
  pos: z.string(),
  meaningZh: z.string(),
  progress: progressSchema,
});

export type CardListItem = z.infer<typeof listItemSchema>;

const listBatchSchema = listBody(listItemSchema);

type CardListBatch = z.infer<typeof listBatchSchema>;

const exampleSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  text: z.string(),
  targetRanges: z.array(z.tuple([z.number().int(), z.number().int()])),
});

export type CardExample = z.infer<typeof exampleSchema>;

const savedCardSchema = z.object({
  id: z.string(),
  lemma: z.string(),
  pos: z.string(),
  meaningZh: z.string(),
  examples: z.array(exampleSchema),
  updatedAt: isoTime,
});

/** The saved card a DUPLICATE_WORD answer carries. */
export type SavedCard = z.infer<typeof savedCardSchema>;

const cardSchema = savedCardSchema.extend({ progress: progressSchema });

export type CardDetail = z.infer<typeof cardSchema>;

const listRoot = ['vocabulary', 'list'] as const;

export const vocabularyListKey = (query: VocabularyQuery) => [...listRoot, query] as const;
export const cardKey = (id: string) => ['vocabulary', 'card', id] as const;

/** The query string of a query: only what differs from no tab, search or filter is sent. */
function vocabularyParams(query: VocabularyQuery, cursor?: string | null): URLSearchParams {
  const params = new URLSearchParams();
  if (query.state !== 'all') {
    params.set('state', query.state);
  }
  if (query.q !== '') {
    params.set('q', query.q);
  }
  for (const mode of REVIEW_MODES) {
    query.rounds[mode].forEach((round) => params.append(`rounds.${mode}`, round));
  }
  params.set('sort', query.sort);
  params.set('direction', query.direction);
  if (cursor) {
    params.set('cursor', cursor);
  }
  return params;
}

/** The list of a query in batches; each batch is kept until the query or the vocabulary changes. */
export function useVocabularyList(query: VocabularyQuery) {
  return useInfiniteQuery({
    queryKey: vocabularyListKey(query),
    queryFn: ({ pageParam, signal }) =>
      apiRequest(`/api/vocabulary?${vocabularyParams(query, pageParam)}`, listBatchSchema, {
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (batch) => batch.meta.nextCursor,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

const cardPath = (id: string) => `/api/vocabulary/${encodeURIComponent(id)}`;

/** One card with its examples and progress, read again when the page gets the focus back. */
export function useCard(id: string) {
  return useQuery({
    queryKey: cardKey(id),
    queryFn: async ({ signal }) =>
      (await apiRequest(cardPath(id), dataBody(cardSchema), { signal })).data,
  });
}

/** `POST /api/vocabulary`: the saved card. */
export async function requestSave(lookupId: string, operationId: string): Promise<CardDetail> {
  const { data } = await apiRequest('/api/vocabulary', dataBody(cardSchema), {
    method: 'POST',
    body: { operationId, lookupId },
  });
  return data;
}

/** `POST /api/vocabulary/:id/replace`: the card with the explanation's meaning and examples. */
export async function requestReplace(
  card: SavedCard,
  lookupId: string,
  operationId: string,
): Promise<CardDetail> {
  const { data } = await apiRequest(`${cardPath(card.id)}/replace`, dataBody(cardSchema), {
    method: 'POST',
    body: { operationId, lookupId, updatedAt: card.updatedAt },
  });
  return data;
}

/** `POST /api/vocabulary/:id/examples/:exampleId/refresh`: the new example. */
export async function requestNewCardExample(
  cardId: string,
  exampleId: string,
  operationId: string,
): Promise<CardExample> {
  const path = `${cardPath(cardId)}/examples/${encodeURIComponent(exampleId)}/refresh`;
  const { data } = await apiRequest(path, dataBody(exampleSchema), {
    method: 'POST',
    body: { operationId },
  });
  return data;
}

const noContent = z.undefined();

/** `DELETE /api/vocabulary/:id`, or `POST /api/vocabulary/bulk-delete` for more than one card. */
export async function requestDelete(ids: readonly string[], operationId: string): Promise<void> {
  if (ids.length === 1) {
    await apiRequest(cardPath(ids[0]), noContent, { method: 'DELETE', body: { operationId } });
    return;
  }
  await apiRequest('/api/vocabulary/bulk-delete', noContent, {
    method: 'POST',
    body: { operationId, ids },
  });
}

/** The saved card of a DUPLICATE_WORD answer's details, or undefined when they hold none. */
export function savedCardOf(details: unknown): SavedCard | undefined {
  const parsed = z.object({ savedCard: savedCardSchema }).safeParse(details);
  return parsed.success ? parsed.data.savedCard : undefined;
}

/** The IDs a SELECTION_CHANGED answer's details name. */
export function missingIdsOf(details: unknown): string[] {
  const parsed = z.object({ missingIds: z.array(z.string()) }).safeParse(details);
  return parsed.success ? parsed.data.missingIds : [];
}

/** Takes cards out of every loaded list, counting them out of each list's total. */
export function forgetCards(queryClient: QueryClient, ids: readonly string[]): void {
  const gone = new Set(ids);
  queryClient.setQueriesData<InfiniteData<CardListBatch>>({ queryKey: listRoot }, (lists) => {
    if (!lists) {
      return lists;
    }
    const removed = loadedItems(lists).filter((item) => gone.has(item.id)).length;
    return {
      ...lists,
      pages: lists.pages.map((batch) => ({
        data: batch.data.filter((item) => !gone.has(item.id)),
        meta: { ...batch.meta, totalCount: Math.max(0, batch.meta.totalCount - removed) },
      })),
    };
  });
  for (const id of ids) {
    queryClient.removeQueries({ queryKey: cardKey(id) });
  }
}

/** Drops every list but the one shown, so each is read again from its first batch next time. */
export function dropOtherLists(queryClient: QueryClient, shown?: VocabularyQuery): void {
  queryClient.removeQueries({
    queryKey: listRoot,
    predicate: (cached) =>
      shown === undefined ||
      JSON.stringify(cached.queryKey) !== JSON.stringify(vocabularyListKey(shown)),
  });
}
