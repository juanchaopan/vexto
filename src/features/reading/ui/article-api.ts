'use client';

// The browser side of the article endpoints (.docs/design/interfaces.md, 文章 and 取得播放地址):
// the list in batches, the IDs of a query, one article, recording a visit and the playback
// address of an article's audio. A list keeps the batches it loaded and their order until its
// query changes, so going back to it shows the same articles; only the visit time of the
// article just read is brought up to date.
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { writeRequest } from '../../../lib/api/access-handling.ts';
import { apiRequest, dataBody, isoTime, listBody } from '../../../lib/api/client.ts';
import type { ArticleQuery } from '../domain/article-query.ts';

const listItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: z.string(),
  feedKey: z.string(),
  categoryKey: z.string(),
  collectedAt: isoTime,
  lastVisitedAt: isoTime.nullable(),
});

export type ArticleListItem = z.infer<typeof listItemSchema>;

const listBatchSchema = listBody(listItemSchema);

type ArticleListBatch = z.infer<typeof listBatchSchema>;

const articleSchema = z.object({
  id: z.string(),
  title: z.string(),
  feedKey: z.string(),
  categoryKey: z.string(),
  author: z.string().nullable(),
  sourceUrl: z.string(),
  collectedAt: isoTime,
  durationMs: z.number().int(),
  sentences: z.array(
    z.object({
      index: z.number().int(),
      paragraphIndex: z.number().int(),
      text: z.string(),
      startMs: z.number().int(),
      endMs: z.number().int(),
    }),
  ),
});

export type ReaderArticle = z.infer<typeof articleSchema>;

const playbackSchema = z.object({
  url: z.string(),
  expiresAt: isoTime,
  durationMs: z.number().int(),
});

export type PlaybackAddress = z.infer<typeof playbackSchema>;

const listRoot = ['articles', 'list'] as const;

export const articleListKey = (query: ArticleQuery) => [...listRoot, query] as const;
const articleKey = (id: string) => ['articles', 'detail', id] as const;

/** The query string of a query: only what differs from no search and no filter is sent. */
function articleParams(query: ArticleQuery, cursor?: string | null): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q !== '') {
    params.set('q', query.q);
  }
  query.feeds.forEach((feed) => params.append('feed', feed));
  query.categories.forEach((category) => params.append('category', category));
  params.set('sort', query.sort);
  params.set('direction', query.direction);
  if (cursor) {
    params.set('cursor', cursor);
  }
  return params;
}

/** The list of a query in batches; each batch is kept until the query changes. */
export function useArticleList(query: ArticleQuery) {
  return useInfiniteQuery({
    queryKey: articleListKey(query),
    queryFn: ({ pageParam, signal }) =>
      apiRequest(`/api/articles?${articleParams(query, pageParam)}`, listBatchSchema, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (batch) => batch.meta.nextCursor,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Every article ID of the query, in the list's order, read fresh for a continuous play. */
export async function fetchArticleIds(queryClient: QueryClient, query: ArticleQuery) {
  const body = await queryClient.fetchQuery({
    queryKey: ['articles', 'ids', query],
    queryFn: ({ signal }) =>
      apiRequest(
        `/api/articles/ids?${articleParams(query)}`,
        dataBody(z.object({ ids: z.array(z.string()) })),
        { signal },
      ),
    staleTime: 0,
    gcTime: 0,
  });
  return body.data.ids;
}

function articleRequest(id: string, signal?: AbortSignal) {
  return apiRequest(`/api/articles/${encodeURIComponent(id)}`, dataBody(articleSchema), {
    signal,
  }).then((body) => body.data);
}

/** One article with its sentences and timings. */
export function useArticle(id: string) {
  return useQuery({
    queryKey: articleKey(id),
    queryFn: ({ signal }) => articleRequest(id, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** One article for the player, from the cache when the reader has read it. */
export function fetchArticle(queryClient: QueryClient, id: string) {
  return queryClient.fetchQuery({
    queryKey: articleKey(id),
    queryFn: ({ signal }) => articleRequest(id, signal),
    staleTime: Infinity,
  });
}

/**
 * Records the visit and shows its time on the article's card in every loaded list. It is a
 * write, so an access error is answered by the rule every write shares.
 */
export async function recordVisit(queryClient: QueryClient, id: string) {
  const { data } = await writeRequest(
    queryClient,
    `/api/articles/${encodeURIComponent(id)}/visit`,
    dataBody(z.object({ lastVisitedAt: isoTime })),
    { method: 'PUT' },
  );
  queryClient.setQueriesData<InfiniteData<ArticleListBatch>>({ queryKey: listRoot }, (lists) =>
    lists
      ? {
          ...lists,
          pages: lists.pages.map((batch) => ({
            ...batch,
            data: batch.data.map((item) =>
              item.id === id ? { ...item, lastVisitedAt: data.lastVisitedAt } : item,
            ),
          })),
        }
      : lists,
  );
}

/** Takes an article that no longer exists out of every loaded list. */
export function forgetArticle(queryClient: QueryClient, id: string) {
  queryClient.setQueriesData<InfiniteData<ArticleListBatch>>({ queryKey: listRoot }, (lists) =>
    lists
      ? {
          ...lists,
          pages: lists.pages.map((batch) => ({
            ...batch,
            data: batch.data.filter((item) => item.id !== id),
          })),
        }
      : lists,
  );
  queryClient.removeQueries({ queryKey: articleKey(id) });
}

/** A fresh playback address of the article's audio, valid for ten minutes. */
export function fetchPlaybackAddress(queryClient: QueryClient, articleId: string) {
  return queryClient.fetchQuery({
    queryKey: ['playback', 'article', articleId],
    queryFn: async ({ signal }) =>
      (
        await apiRequest('/api/media/playback', dataBody(playbackSchema), {
          method: 'POST',
          body: { kind: 'article', articleId },
          signal,
        })
      ).data,
    staleTime: 0,
    gcTime: 0,
  });
}
