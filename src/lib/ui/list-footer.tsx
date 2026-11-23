'use client';

// The end of a list that loads in batches of 20 (.docs/design/screens.md, 列表的分批加载): a Load
// more button that also loads the next batch by itself once it comes within 80 pixels of the
// bottom of the screen; a disabled `Loading…` with a spinner while a batch loads; the failure and
// Retry in the button's place; and `All loaded` once nothing is left.
import { useEffect, useRef } from 'react';
import { Button, buttonClassName } from './button.tsx';
import { Icon } from './icon.tsx';
import { RetryStatus } from './retry-status.tsx';

export type ListFooterState =
  | { kind: 'more' }
  | { kind: 'loading' }
  | { kind: 'done' }
  | { kind: 'failed'; message: string; onRetry?: () => void };

export type ListFooterProps = {
  state: ListFooterState;
  /** Loads the next batch; `manual` is true when the person pressed Load more. */
  onLoadMore: (manual: boolean) => void;
  /** Whether coming near the bottom loads the next batch; off while a list pauses it. */
  autoLoad?: boolean;
};

const AUTO_LOAD_MARGIN = '0px 0px 80px 0px';

export function ListFooter({ state, onLoadMore, autoLoad = true }: ListFooterProps) {
  const button = useRef<HTMLButtonElement>(null);
  const loadMore = useRef(onLoadMore);
  useEffect(() => {
    loadMore.current = onLoadMore;
  });

  const waiting = state.kind === 'more' && autoLoad;
  useEffect(() => {
    const target = button.current;
    if (!waiting || !target || typeof IntersectionObserver === 'undefined') {
      return;
    }
    // A new observer for every batch reports at once whether the button is still near the
    // bottom, as it is after a short batch.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          loadMore.current(false);
        }
      },
      { rootMargin: AUTO_LOAD_MARGIN },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [waiting]);

  return (
    <div className="flex justify-center p-3.5">
      {state.kind === 'more' ? (
        <button
          ref={button}
          type="button"
          className={buttonClassName()}
          onClick={() => onLoadMore(true)}
        >
          Load more
        </button>
      ) : null}
      {state.kind === 'loading' ? (
        <Button disabled aria-busy="true">
          <Icon name="loader-circle" spin />
          Loading…
        </Button>
      ) : null}
      {state.kind === 'done' ? (
        <span role="status" className="text-[11px] text-muted">
          All loaded
        </span>
      ) : null}
      {state.kind === 'failed' ? (
        <RetryStatus className="flex-1" message={state.message} onRetry={state.onRetry} />
      ) : null}
    </div>
  );
}
