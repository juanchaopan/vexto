'use client';

// Whether the person reached the current page from another page of the application, so a close
// button can go back to "the screen that opened it" (.docs/design/screens.md, 画面之间的跳转).
// A page opened directly, from a bookmark or another site, has nothing in the application to go
// back to, and its close button goes to a fixed page instead.
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';

let pagesSeen = 0;

/** Counts the pages shown in this document; rendered once, in the root layout. */
export function NavigationHistory() {
  const pathname = usePathname();
  useEffect(() => {
    pagesSeen += 1;
  }, [pathname]);
  return null;
}

/** True when an earlier page of the application is in the browser history. */
export function cameFromAnotherPage(): boolean {
  return pagesSeen > 1;
}

/**
 * A close action: back to the page that opened this one, or to `fallback` when the page was
 * opened directly.
 */
export function useCloseTo(fallback: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (cameFromAnotherPage()) {
      router.back();
    } else {
      router.replace(fallback);
    }
  }, [router, fallback]);
}
