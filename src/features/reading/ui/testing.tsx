// Stand-ins for the component tests of the reading screens: an audio element whose time the test
// moves, the answers of the article endpoints, and a page with a fresh cache, the notices and the
// player's connection to a recorded router. Only test files import this module.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastViewport } from '../../../lib/ui/toast.tsx';
import { useArticleListStore } from './article-list-store.ts';
import type { ArticleListItem, ReaderArticle } from './article-api.ts';
import { PlayerHost } from './player-host.tsx';
import { reset, setAudioFactory, type PlayerAudio } from './player.ts';
import { usePlayerStore } from './player-store.ts';
import { DEFAULT_ARTICLE_QUERY } from '../domain/article-query.ts';

/** An audio element that plays nothing: the test moves its time and ends it. */
export class FakeAudio extends EventTarget implements PlayerAudio {
  src = '';
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  /** How the next play() calls answer. */
  answer: 'play' | 'blocked' | 'fail' = 'play';
  plays = 0;

  play(): Promise<void> {
    this.plays += 1;
    if (this.answer === 'blocked') {
      return Promise.reject(new DOMException('Autoplay is not allowed.', 'NotAllowedError'));
    }
    if (this.answer === 'fail') {
      return Promise.reject(new DOMException('The audio cannot be decoded.', 'NotSupportedError'));
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  }

  load(): void {}

  removeAttribute(name: string): void {
    if (name === 'src') {
      this.src = '';
    }
  }

  /** Moves the playing position, as the browser reports time passing. */
  moveTo(seconds: number): void {
    this.currentTime = seconds;
    this.dispatchEvent(new Event('timeupdate'));
  }

  end(): void {
    this.paused = true;
    this.dispatchEvent(new Event('ended'));
  }
}

export function readerArticle(id: string, change: Partial<ReaderArticle> = {}): ReaderArticle {
  return {
    id,
    title: `Lunar dust shields ${id}`,
    feedKey: 'loc-inside-adams',
    categoryKey: 'history',
    author: 'Dana Whitfield',
    sourceUrl: `https://news.example.org/${id}`,
    collectedAt: '2026-11-20T09:06:00.000Z',
    durationMs: 9_000,
    sentences: [
      { index: 0, paragraphIndex: 0, text: 'Moon dust is sticky.', startMs: 0, endMs: 2_000 },
      { index: 1, paragraphIndex: 0, text: 'It clings to suits.', startMs: 2_300, endMs: 4_500 },
      {
        index: 2,
        paragraphIndex: 1,
        text: 'Engineers want shields.',
        startMs: 4_800,
        endMs: 8_700,
      },
    ],
    ...change,
  };
}

export function listItem(index: number, change: Partial<ArticleListItem> = {}): ArticleListItem {
  return {
    id: `article-${index}`,
    title: `Article title ${index}`,
    excerpt: `First sentence of article ${index}.`,
    feedKey: 'nasa-technology',
    categoryKey: 'technology',
    collectedAt: '2026-11-22T09:04:00.000Z',
    lastVisitedAt: null,
    ...change,
  };
}

export const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const errorBody = (code: string, retryable = false) => ({
  error: { code, message: 'Test failure.', retryable, requestId: 'req_test' },
});

/** Puts the player and the list back to how a fresh page has them, with a new audio stand-in. */
export function freshPlayer(): FakeAudio {
  reset();
  const audio = new FakeAudio();
  setAudioFactory(() => audio);
  usePlayerStore.setState({ speed: 1, queue: null, queueIndex: 0, autoplay: null });
  useArticleListStore.setState({
    query: DEFAULT_ARTICLE_QUERY,
    opened: null,
    restoring: false,
    reveal: null,
  });
  window.localStorage.clear();
  window.sessionStorage.clear();
  return audio;
}

/** Renders the screen inside a fresh cache, with the notices and the player's connection. */
export function renderScreen(screen: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlayerHost />
      {screen}
      <ToastViewport />
    </QueryClientProvider>,
  );
}
