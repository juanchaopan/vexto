// The reader and its player (.docs/design/screens.md, 阅读页和播放器) against stand-ins for the
// endpoints and the audio element: the article and its attribution, the highlight following the
// audio's time, playing from a sentence, the speed, the next article of a continuous play, Tap to
// continue, the lock screen controls, failures, an article that is gone, and the lookup seam.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { formatFullDateTime } from '../../../lib/format/time-text.ts';
import { provideLookup } from '../../../lib/ui/lookup-bridge.ts';
import { dismissToast } from '../../../lib/ui/toast.tsx';
import { usePlayerStore } from './player-store.ts';
import { ReaderScreen } from './reader-screen.tsx';
import {
  errorBody,
  freshPlayer,
  json,
  readerArticle,
  renderScreen,
  type FakeAudio,
} from './testing.tsx';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/articles/a',
  useRouter: () => router,
}));

const fetchMock = vi.spyOn(window, 'fetch');

type Answers = {
  article?: (id: string) => Response;
  playback?: () => Response;
};

const requests: { method: string; path: string; body: unknown }[] = [];

function playbackAddress(articleId: string) {
  return json(200, {
    data: {
      url: `https://audio.test/${articleId}.mp3`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      durationMs: 9_000,
    },
  });
}

function answer(answers: Answers = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input), window.location.href);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ method, path: url.pathname, body });
    if (url.pathname === '/api/media/playback') {
      return answers.playback?.() ?? playbackAddress((body as { articleId: string }).articleId);
    }
    if (/^\/api\/articles\/[^/]+\/visit$/.test(url.pathname)) {
      return json(200, { data: { lastVisitedAt: '2026-11-22T10:00:00.000Z' } });
    }
    const article = /^\/api\/articles\/([^/]+)$/.exec(url.pathname);
    if (article) {
      return answers.article?.(article[1]) ?? json(200, { data: readerArticle(article[1]) });
    }
    return json(500, errorBody('INTERNAL', true));
  });
}

let audio: FakeAudio;

beforeEach(() => {
  audio = freshPlayer();
  requests.length = 0;
  fetchMock.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
  router.back.mockReset();
  answer();
});

afterEach(() => {
  act(() => dismissToast());
  cleanup();
});

async function openReader(id = 'a') {
  renderScreen(<ReaderScreen articleId={id} />);
  await screen.findByRole('heading', { level: 1, name: `Lunar dust shields ${id}` });
}

const player = () => screen.getByRole('region', { name: 'Article player' });
const row = (index: number) =>
  document.querySelector<HTMLElement>(`[data-sentence-row="${index}"]`) as HTMLElement;
/** The play button of the article head; the player's own button comes after it. */
const topButton = (name: string) => screen.getAllByRole('button', { name })[0];

async function play() {
  await userEvent.click(topButton('Play article'));
  await waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'));
}

describe('the article', () => {
  it('shows the head, the sentences, the attribution and the player, and records the visit', async () => {
    await openReader();

    expect(screen.getByText('Inside Adams', { selector: 'header span' })).toBeVisible();
    expect(screen.getByText('History')).toBeVisible();
    expect(screen.getByText('11 words · 1 min listening')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Play sentence \d$/ })).toHaveLength(3);
    const source = screen.getByRole('contentinfo', { name: 'Source' });
    expect(
      within(source).getByText(
        'Courtesy of the Library of Congress, Inside Adams blog. By Dana Whitfield.',
      ),
    ).toBeVisible();
    const original = within(source).getByRole('link', { name: 'Original' });
    expect(original).toHaveAttribute('href', 'https://news.example.org/a');
    expect(original).toHaveAttribute('target', '_blank');
    const collected = formatFullDateTime(new Date('2026-11-20T09:06:00.000Z'));
    expect(within(source).getByLabelText(`Collected ${collected}`)).toHaveTextContent(collected);
    expect(within(player()).getByText('Lunar dust shields a · 1/3')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Play article' })).toHaveLength(2);
    expect(row(0)).not.toHaveAttribute('data-active');
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PUT',
        path: '/api/articles/a/visit',
        body: undefined,
      }),
    );
  });

  it('starts paragraphs after the first with more space', async () => {
    await openReader();

    expect(row(1).className).not.toContain('mt-[17px]');
    expect(row(2).className).toContain('mt-[17px]');
  });
});

describe('playing', () => {
  it('fetches the playback address and highlights the sentence the audio is in', async () => {
    await openReader();

    await play();

    expect(requests).toContainEqual({
      method: 'POST',
      path: '/api/media/playback',
      body: { kind: 'article', articleId: 'a' },
    });
    expect(audio.src).toBe('https://audio.test/a.mp3');
    expect(screen.getAllByRole('button', { name: 'Pause article' })).toHaveLength(2);
    expect(row(0)).toHaveAttribute('data-active');

    act(() => audio.moveTo(2.4));
    expect(row(1)).toHaveAttribute('data-active');
    expect(row(0)).not.toHaveAttribute('data-active');
    expect(within(player()).getByText('Lunar dust shields a · 2/3')).toBeVisible();

    act(() => audio.moveTo(4.6));
    expect(row(1)).toHaveAttribute('data-active');

    act(() => audio.moveTo(5));
    expect(row(2)).toHaveAttribute('data-active');
  });

  it('pauses and resumes from where it paused', async () => {
    await openReader();
    await play();
    act(() => audio.moveTo(2.5));

    await userEvent.click(within(player()).getByRole('button', { name: 'Pause article' }));
    expect(audio.paused).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Resume article' })).toHaveLength(1);

    await userEvent.click(topButton('Resume article'));
    await waitFor(() => expect(audio.paused).toBe(false));
    expect(audio.currentTime).toBe(2.3);
  });

  it('plays one sentence from its own button and stops at its end', async () => {
    await openReader();

    await userEvent.click(screen.getByRole('button', { name: 'Play sentence 2' }));
    await waitFor(() => expect(audio.paused).toBe(false));

    expect(audio.currentTime).toBe(2.3);
    expect(row(1)).toHaveAttribute('data-active');
    const stopButton = screen.getByRole('button', {
      name: 'Stop sentence 2 and clear the selection',
    });
    expect(screen.getByRole('button', { name: 'Play article from sentence 2' })).toBeVisible();

    act(() => audio.moveTo(4.5));
    expect(audio.paused).toBe(true);
    expect(row(1)).toHaveAttribute('data-active');

    await userEvent.click(stopButton);
    expect(row(1)).not.toHaveAttribute('data-active');
    expect(screen.getByRole('button', { name: 'Play sentence 2' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Play article' })).toHaveLength(2);
  });

  it('plays from the selected sentence to the end with the top button', async () => {
    await openReader();
    await userEvent.click(screen.getByRole('button', { name: 'Play sentence 3' }));
    await waitFor(() => expect(audio.paused).toBe(false));

    await userEvent.click(topButton('Play article from sentence 3'));

    await waitFor(() => expect(usePlayerStore.getState().mode).toBe('article'));
    expect(audio.currentTime).toBe(4.8);
    expect(screen.getAllByRole('button', { name: 'Pause article' })).toHaveLength(2);
  });

  it('moves to a sentence with the progress slider', async () => {
    await openReader();
    await play();

    const slider = within(player()).getByRole('slider', { name: 'Article progress' });
    await userEvent.fill(slider, '2');

    await waitFor(() => expect(audio.currentTime).toBe(4.8));
    expect(row(2)).toHaveAttribute('data-active');
  });

  it('changes the speed from the speed panel and keeps it on the device', async () => {
    await openReader();
    await play();

    await userEvent.click(screen.getByRole('button', { name: 'Playback speed, 1×' }));
    const panel = screen.getByRole('dialog', { name: 'Playback speed' });
    expect(within(panel).getByRole('radio', { name: '1×' })).toBeChecked();
    await userEvent.click(within(panel).getByRole('radio', { name: '1.25×' }));

    expect(screen.queryByRole('dialog', { name: 'Playback speed' })).toBeNull();
    expect(audio.playbackRate).toBe(1.25);
    expect(screen.getByRole('button', { name: 'Playback speed, 1.25×' })).toBeVisible();
    expect(window.localStorage.getItem('vexto.playback-speed')).toBe('1.25');
  });

  it('offers Tap to continue when the browser refuses to start the audio', async () => {
    await openReader();
    audio.answer = 'blocked';

    await userEvent.click(topButton('Play article'));

    const tap = await within(player()).findByRole('button', { name: 'Tap to continue' });
    expect(within(player()).queryByRole('slider')).toBeNull();
    audio.answer = 'play';
    await userEvent.click(tap);
    await waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'));
    expect(within(player()).getByRole('button', { name: 'Pause article' })).toBeVisible();
  });

  it('says the article could not play, and plays it on Retry', async () => {
    let refuse = true;
    answer({
      playback: () => (refuse ? json(503, errorBody('UNAVAILABLE', true)) : playbackAddress('a')),
    });
    await openReader();

    await userEvent.click(topButton('Play article'));

    const notice = await screen.findByRole('status');
    await waitFor(() => expect(notice).toHaveTextContent("Couldn't play this article.Retry"));
    expect(usePlayerStore.getState().status).toBe('paused');
    refuse = false;
    await userEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'));
  });
});

describe('a continuous play', () => {
  it('shows the next article button, then goes through the list to the next article', async () => {
    usePlayerStore.setState({ queue: ['a', 'b'], queueIndex: 0, autoplay: 'a' });
    await openReader('a');
    await waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'));
    expect(within(player()).getByRole('button', { name: 'Next article' })).toBeVisible();

    act(() => audio.end());

    expect(router.push).toHaveBeenCalledWith('/');
    expect(router.push).not.toHaveBeenCalledWith('/articles/b');
    await waitFor(() => expect(router.push).toHaveBeenLastCalledWith('/articles/b'), {
      timeout: 2_000,
    });
    expect(usePlayerStore.getState()).toMatchObject({ queueIndex: 1, autoplay: 'b' });
  });

  it('skips to the next article with the next article button', async () => {
    usePlayerStore.setState({ queue: ['a', 'b', 'c'], queueIndex: 0, autoplay: 'a' });
    await openReader('a');

    await userEvent.click(within(player()).getByRole('button', { name: 'Next article' }));

    await waitFor(() => expect(router.push).toHaveBeenLastCalledWith('/articles/b'), {
      timeout: 2_000,
    });
  });

  it('says playback finished after the last article', async () => {
    usePlayerStore.setState({ queue: ['a'], queueIndex: 0, autoplay: 'a' });
    await openReader('a');
    await waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'));

    act(() => audio.end());

    expect(router.push).toHaveBeenCalledWith('/');
    expect(await screen.findByText('Playback finished.')).toBeVisible();
    expect(usePlayerStore.getState().queue).toBeNull();
  });

  it('skips an article that is gone and opens the one after it', async () => {
    answer({
      article: (id) =>
        id === 'b' ? json(404, errorBody('NOT_FOUND')) : json(200, { data: readerArticle(id) }),
    });
    usePlayerStore.setState({ queue: ['a', 'b', 'c'], queueIndex: 1, autoplay: 'b' });

    renderScreen(<ReaderScreen articleId="b" />);

    expect(await screen.findByText('This article is no longer available.')).toBeVisible();
    expect(router.push).toHaveBeenCalledWith('/');
    await waitFor(() => expect(router.push).toHaveBeenLastCalledWith('/articles/c'), {
      timeout: 2_000,
    });
  });
});

describe('the lock screen controls', () => {
  it('show the title and source, and play, pause and move to the next article', async () => {
    const handlers = new Map<string, (() => void) | null>();
    const session = {
      metadata: null as unknown,
      playbackState: 'none',
      setActionHandler: (action: string, handler: (() => void) | null) => {
        handlers.set(action, handler);
      },
    };
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(init: object) {
          Object.assign(this, init);
        }
      },
    );
    usePlayerStore.setState({ queue: ['a', 'b'], queueIndex: 0, autoplay: 'a' });
    await openReader('a');
    await waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'));

    expect({ ...(session.metadata as object) }).toEqual({
      title: 'Lunar dust shields a',
      artist: 'Inside Adams',
      album: 'vexto',
    });
    expect(session.playbackState).toBe('playing');
    act(() => handlers.get('pause')?.());
    expect(audio.paused).toBe(true);
    act(() => handlers.get('play')?.());
    await waitFor(() => expect(audio.paused).toBe(false));
    act(() => handlers.get('nexttrack')?.());
    await waitFor(() => expect(router.push).toHaveBeenLastCalledWith('/articles/b'), {
      timeout: 2_000,
    });

    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaSession');
  });

  it('offer no next article without a queue', async () => {
    const handlers = new Map<string, (() => void) | null>();
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null,
        playbackState: 'none',
        setActionHandler: (action: string, handler: (() => void) | null) => {
          handlers.set(action, handler);
        },
      },
    });
    await openReader('a');
    await play();

    expect(handlers.get('nexttrack')).toBeNull();
    expect(handlers.get('pause')).toEqual(expect.any(Function));

    Reflect.deleteProperty(navigator, 'mediaSession');
  });
});

describe('failures', () => {
  it('goes back to the list with a notice when the article is gone', async () => {
    answer({ article: () => json(404, errorBody('NOT_FOUND')) });

    renderScreen(<ReaderScreen articleId="gone" />);

    expect(await screen.findByText('This article is no longer available.')).toBeVisible();
    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('shows a failed load in place of the text, with Retry and without a player', async () => {
    let failing = true;
    answer({
      article: (id) =>
        failing ? json(500, errorBody('INTERNAL', true)) : json(200, { data: readerArticle(id) }),
    });
    renderScreen(<ReaderScreen articleId="a" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this article.Retry");
    expect(screen.getByRole('button', { name: 'Articles' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Article player' })).toBeNull();

    failing = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Article player' })).toBeVisible();
  });
});

describe('looking words up', () => {
  it('sends a tapped word with its sentence and its place in it to the lookup bridge', async () => {
    const bridge = { lookUp: vi.fn(), openSelectionTool: vi.fn() };
    const remove = provideLookup(bridge);
    await openReader();

    await userEvent.click(screen.getByText('shields.'));

    expect(bridge.lookUp).toHaveBeenCalledWith({
      context: { kind: 'article', articleId: 'a', firstSentence: 2, lastSentence: 2 },
      contextText: 'Engineers want shields.',
      selection: { start: 15, end: 22 },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Select words for lookup' }));
    expect(bridge.openSelectionTool).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ kind: 'article', articleId: 'a' }),
      }),
    );
    remove();
  });

  it('offers no lookup without a bridge', async () => {
    await openReader();

    expect(screen.getByRole('button', { name: 'Select words for lookup' })).toBeDisabled();
  });
});
