'use client';

// What every list that loads in batches of 20 shares (.docs/design/screens.md, 列表的分批加载):
// the items of the loaded batches, the total of the list, the state of its footer, and loading
// the next batch with a notice once it is in and, after a press of Load more, the focus on the
// first item of the new batch.
import type { InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { offersRetry } from '../api/client.ts';
import type { ListFooterState } from './list-footer.tsx';
import { showToast } from './toast.tsx';

const MORE_LOADED = 'More records loaded.';

export type ListBatch<T> = {
  data: T[];
  meta: { nextCursor: string | null; totalCount: number };
};

/** The parts of an infinite query over list batches that the paging rules read. */
export type BatchedList<T> = {
  data: InfiniteData<ListBatch<T>> | undefined;
  error: unknown;
  isError: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<{
    data?: InfiniteData<ListBatch<T>>;
    isFetchNextPageError: boolean;
  }>;
};

/** The items of the loaded batches, each once even when a later batch repeats one. */
export function loadedItems<T extends { id: string }>(
  data: InfiniteData<ListBatch<T>> | undefined,
): T[] {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const item of data?.pages.flatMap((batch) => batch.data) ?? []) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

/** The total of the list, or undefined while it is unknown or its first batch failed. */
export function listTotal<T>(list: BatchedList<T>): number | undefined {
  return list.isError && !list.data ? undefined : list.data?.pages[0]?.meta.totalCount;
}

/** The footer under the loaded items; a failed batch shows `message`, with Retry when it helps. */
export function footerStateOf<T>(
  list: BatchedList<T>,
  message: string,
  retry: () => void,
): ListFooterState {
  if (list.isFetchingNextPage) {
    return { kind: 'loading' };
  }
  if (list.isFetchNextPageError) {
    return { kind: 'failed', message, onRetry: offersRetry(list.error) ? retry : undefined };
  }
  return list.hasNextPage ? { kind: 'more' } : { kind: 'done' };
}

/**
 * Loading the next batch: a notice once it is in, and after a press of Load more the focus on
 * the element `focusOf` gives for its first item, as soon as that element is drawn. `count` is
 * the number of items loaded before.
 */
export function useLoadMore<T extends { id: string }>(
  list: BatchedList<T>,
  count: number,
  focusOf: (id: string) => HTMLElement | null,
) {
  const focusTarget = useRef<string | null>(null);
  useEffect(() => {
    const target = focusTarget.current;
    const element = target ? focusOf(target) : null;
    if (element) {
      focusTarget.current = null;
      element.focus();
    }
  });
  return (manual: boolean) => {
    void list.fetchNextPage().then((result) => {
      if (result.isFetchNextPageError) {
        return;
      }
      showToast(MORE_LOADED);
      const first = loadedItems(result.data)[count];
      if (manual && first) {
        focusTarget.current = first.id;
      }
    });
  };
}
