'use client';

// The state of the article player (.docs/design/screens.md, 播放), shared by the reader, its
// player bar and the list: which article is loaded, whether it plays, the current sentence, the
// selected sentence, the speed and the queue of a continuous play. The speed is a setting of the
// device, kept in localStorage across articles, reloads and logging out; the queue is kept in
// sessionStorage as well as in memory (.docs/design/rules.md, 文章列表、搜索和播放).
import { create } from 'zustand';
import type { SentenceTiming } from '../domain/reading.ts';

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export type PlayerArticle = {
  id: string;
  title: string;
  feedKey: string;
  timings: SentenceTiming[];
};

/**
 * `loading` while the playback address or the audio is on its way, `blocked` when the browser
 * refused to start the audio without a tap.
 */
export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'blocked';

/** The whole article to its end, or only the selected sentence. */
export type PlayMode = 'article' | 'sentence';

export type PlayerState = {
  article: PlayerArticle | null;
  status: PlayerStatus;
  mode: PlayMode;
  /** The current sentence: where the audio is, or where it stopped. */
  sentence: number;
  /** True once the article has played, so the top button resumes rather than starts. */
  started: boolean;
  /** The sentence whose own button was pressed; its button stops it. */
  selected: number | null;
  speed: number;
  /** The article IDs of a continuous play, or null when there is none. */
  queue: string[] | null;
  queueIndex: number;
  /** The article the reader starts playing from its first sentence once it has opened it. */
  autoplay: string | null;
};

const SPEED_KEY = 'vexto.playback-speed';
const QUEUE_KEY = 'vexto.playback-queue';

function storedSpeed(): number {
  if (typeof window === 'undefined') {
    return 1;
  }
  const speed = Number(window.localStorage.getItem(SPEED_KEY));
  return (SPEEDS as readonly number[]).includes(speed) ? speed : 1;
}

function storedQueue(): Pick<PlayerState, 'queue' | 'queueIndex'> {
  if (typeof window === 'undefined') {
    return { queue: null, queueIndex: 0 };
  }
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(QUEUE_KEY) ?? 'null') as unknown;
    const { queue, queueIndex } = (saved ?? {}) as { queue?: unknown; queueIndex?: unknown };
    if (
      Array.isArray(queue) &&
      queue.every((id) => typeof id === 'string') &&
      Number.isInteger(queueIndex) &&
      (queueIndex as number) >= 0 &&
      (queueIndex as number) < queue.length
    ) {
      return { queue, queueIndex: queueIndex as number };
    }
  } catch {
    // A queue that cannot be read is no queue.
  }
  return { queue: null, queueIndex: 0 };
}

/** The player with nothing loaded and nothing playing; the speed and queue stay as they are. */
export const stoppedPlayer = {
  article: null,
  status: 'idle',
  mode: 'article',
  sentence: 0,
  started: false,
  selected: null,
  autoplay: null,
} satisfies Partial<PlayerState>;

export const usePlayerStore = create<PlayerState>(() => ({
  ...stoppedPlayer,
  speed: storedSpeed(),
  ...storedQueue(),
}));

if (typeof window !== 'undefined') {
  usePlayerStore.subscribe((state, previous) => {
    if (state.speed !== previous.speed) {
      window.localStorage.setItem(SPEED_KEY, String(state.speed));
    }
    if (state.queue !== previous.queue || state.queueIndex !== previous.queueIndex) {
      if (state.queue) {
        window.sessionStorage.setItem(
          QUEUE_KEY,
          JSON.stringify({ queue: state.queue, queueIndex: state.queueIndex }),
        );
      } else {
        window.sessionStorage.removeItem(QUEUE_KEY);
      }
    }
  });
}

/** A speed as the player shows it: `1×`, `1.25×`. */
export function speedText(speed: number): string {
  return `${speed}×`;
}

/** True while the audio plays or is about to, rather than paused or stopped. */
export function isPlaying(status: PlayerStatus): boolean {
  return status === 'playing' || status === 'loading';
}
