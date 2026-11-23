'use client';

// How the Vocabulary screen is come to (.docs/design/screens.md, 顶栏 and 列表的分批加载). Each
// time the screen shows, coming back from card details or a review restores the list as it was,
// with the focus on what was opened; any other way in starts the list over, and so does the top
// bar's Vocabulary button pressed on this screen. The screen may be kept while hidden and shown
// again, so this is decided each time it shows, not only when it is first made.
import { useEffect, useRef } from 'react';
import { clearVocabularyReturn, peekVocabularyReturn } from '../../../lib/ui/vocabulary-return.ts';
import { VOCABULARY_PATH } from './paths.ts';
import { useVocabularyStore } from './vocabulary-store.ts';

/** Keeps the latest callback for effects that run with no dependencies on it. */
function useLatest<T>(value: T) {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  return latest;
}

/**
 * Each time the screen shows: a return keeps the list and, once it is loaded, restores the scroll
 * position and the focus of that moment; anything else calls `onStartOver`. The return is used up
 * just after, so the effect running twice in a row reads it both times.
 */
export function useShowing(loaded: boolean, onStartOver: () => void): void {
  const startOver = useLatest(onStartOver);
  const returning = useRef<{ focus: string | null } | null>(null);

  useEffect(() => {
    const visit = peekVocabularyReturn();
    const used = setTimeout(clearVocabularyReturn, 0);
    returning.current = visit;
    if (!visit) {
      startOver.current();
    }
    return () => clearTimeout(used);
  }, [startOver]);

  useEffect(() => {
    const visit = returning.current;
    if (!visit || !loaded) {
      return;
    }
    returning.current = null;
    window.scrollTo(0, useVocabularyStore.getState().scrollY);
    if (visit.focus) {
      document.querySelector<HTMLElement>(visit.focus)?.focus({ preventScroll: true });
    }
  });
}

/** The top bar's Vocabulary button pressed while the screen shows: `onReset` starts over. */
export function useNavigationReset(onReset: () => void): void {
  const reset = useLatest(onReset);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (link && new URL((link as HTMLAnchorElement).href).pathname === VOCABULARY_PATH) {
        reset.current();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [reset]);
}
