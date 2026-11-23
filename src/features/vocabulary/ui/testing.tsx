// Stand-ins for the component tests of the vocabulary screens: the answers of the vocabulary and
// review counts endpoints, cards in the shapes they send, and a page with a fresh cache and the
// notices. Only test files import this module.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { MockInstance } from 'vitest';
import { ToastViewport } from '../../../lib/ui/toast.tsx';
import { clearVocabularyReturn } from '../../../lib/ui/vocabulary-return.ts';
import { DEFAULT_VOCABULARY_QUERY } from '../domain/vocabulary-query.ts';
import type { CardDetail, CardListItem } from './vocabulary-api.ts';
import { useVocabularyStore } from './vocabulary-store.ts';

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const errorBody = (code: string, retryable = false, details?: unknown) => ({
  error: { code, message: 'Test failure.', retryable, requestId: 'req_test', details },
});

const NEW = { round: 0, dueAt: null };

/** A card of the list, `word<n>` with a meaning and new progress unless changed. */
export function cardItem(index: number, change: Partial<CardListItem> = {}): CardListItem {
  return {
    id: `card-${index}`,
    lemma: `word${String(index).padStart(2, '0')}`,
    pos: 'adjective',
    meaningZh: '有适应力的；能迅速恢复的',
    progress: { speak: NEW, spell: NEW, translate: NEW },
    ...change,
  };
}

/** A card's details with two examples. */
export function cardDetail(id: string, change: Partial<CardDetail> = {}): CardDetail {
  return {
    id,
    lemma: 'resilient',
    pos: 'adjective',
    meaningZh: '有适应力的；能迅速恢复的',
    updatedAt: '2026-11-22T09:00:00.000Z',
    progress: {
      speak: NEW,
      spell: { round: 2, dueAt: '2026-11-20T09:00:00.000Z' },
      translate: { round: 7, dueAt: null },
    },
    examples: [
      {
        id: 'example-1',
        position: 0,
        text: 'A resilient city can adapt to unexpected challenges.',
        targetRanges: [[2, 11]],
      },
      {
        id: 'example-2',
        position: 1,
        text: 'She remained resilient during a difficult first year abroad.',
        targetRanges: [[13, 22]],
      },
    ],
    ...change,
  };
}

export type SentRequest = { method: string; path: string; params: URLSearchParams; body: unknown };

export type Route = (request: SentRequest) => Response | Promise<Response> | undefined;

/**
 * Answers fetch with the first route that answers; the review counts are answered with fixed
 * counts unless a route answers them, and anything else fails. Returns the requests sent.
 */
export function standIn(
  fetchMock: MockInstance<typeof window.fetch>,
  ...routes: Route[]
): SentRequest[] {
  const sent: SentRequest[] = [];
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input), window.location.href);
    const text = typeof init?.body === 'string' ? init.body : undefined;
    const request: SentRequest = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      params: url.searchParams,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    };
    sent.push(request);
    for (const route of routes) {
      const response = await route(request);
      if (response) {
        return response;
      }
    }
    if (request.path === '/api/review/counts') {
      return json(200, { data: { spell: { due: 3, new: 2 }, translate: { due: 2, new: 2 } } });
    }
    return json(500, errorBody('INTERNAL', true));
  });
  return sent;
}

/** A list answer of these cards. */
export function listAnswer(
  items: CardListItem[],
  nextCursor: string | null = null,
  total?: number,
) {
  return json(200, { data: items, meta: { nextCursor, totalCount: total ?? items.length } });
}

/** Puts the Vocabulary screen's lasting state back to how a fresh page has it. */
export function freshVocabulary(): void {
  useVocabularyStore.setState({
    query: DEFAULT_VOCABULARY_QUERY,
    selecting: false,
    selected: [],
    scrollY: 0,
  });
  clearVocabularyReturn();
}

/** Renders the screen inside a fresh cache, with the notices. */
export function renderWithCache(screen: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {screen}
      <ToastViewport />
    </QueryClientProvider>,
  );
}
