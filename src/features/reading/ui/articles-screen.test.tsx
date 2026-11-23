// The Articles screen (.docs/design/screens.md, Articles) against a stand-in for the article
// endpoints: the cards and the count, the empty states, the search, the Source and Category
// filters and the sort with the requests they send, batches with Load more, the failures in place
// of the list and of Load more, and starting or stopping playback from the list. Loading a batch
// when Load more comes near the bottom is tested with the footer itself (list-footer.test.tsx);
// here the button is only pressed, so the observer that would load by itself is stood in for.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { formatDateTime } from '../../../lib/format/time-text.ts';
import { dismissToast } from '../../../lib/ui/toast.tsx';
import type { ArticleListItem } from './article-api.ts';
import { ArticlesScreen } from './articles-screen.tsx';
import { usePlayerStore } from './player-store.ts';
import { errorBody, freshPlayer, json, listItem, renderScreen } from './testing.tsx';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => router,
}));

const fetchMock = vi.spyOn(window, 'fetch');

type Batch = { items: ArticleListItem[]; nextCursor?: string | null; totalCount?: number };
type ListAnswer = (params: URLSearchParams) => Response;

const listRequests: URLSearchParams[] = [];

function batch({ items, nextCursor = null, totalCount = items.length }: Batch) {
  return json(200, { data: items, meta: { nextCursor, totalCount } });
}

function answer(list: ListAnswer, ids: string[] = []) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input), window.location.href);
    if (url.pathname === '/api/articles/ids') {
      return json(200, { data: { ids } });
    }
    if (url.pathname === '/api/articles') {
      listRequests.push(url.searchParams);
      return list(url.searchParams);
    }
    return json(500, errorBody('INTERNAL', true));
  });
}

const items = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => listItem(from + index));

beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  freshPlayer();
  listRequests.length = 0;
  fetchMock.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  act(() => dismissToast());
  cleanup();
});

async function openList() {
  renderScreen(<ArticlesScreen />);
  await waitFor(() => expect(listRequests.length).toBeGreaterThan(0));
}

const lastRequest = () => Object.fromEntries(listRequests.at(-1)?.entries() ?? []);
const playAll = () => screen.getByRole('button', { name: 'Play all articles' });

describe('the list', () => {
  it('shows the cards newest first with the count and Load more', async () => {
    const visited = listItem(1, {
      lastVisitedAt: '2026-11-22T09:40:00.000Z',
      feedKey: 'nist-news',
      categoryKey: 'technology',
    });
    answer(() => batch({ items: [visited, ...items(2, 19)], nextCursor: 'next', totalCount: 23 }));

    await openList();

    expect(await screen.findByText('23 articles')).toBeVisible();
    expect(lastRequest()).toEqual({ sort: 'collected', direction: 'desc' });
    expect(screen.getByRole('heading', { level: 1, name: 'Articles' })).toBeVisible();
    const card = screen.getByText('Article title 1').closest('article') as HTMLElement;
    expect(within(card).getByText('First sentence of article 1.')).toBeVisible();
    expect(within(card).getByText('NIST News')).toBeVisible();
    expect(within(card).getByText('Technology')).toBeVisible();
    expect(
      within(card).getByText(`Collected ${formatDateTime(new Date(visited.collectedAt))}`),
    ).toBeVisible();
    expect(
      within(card).getByText(`Last visited ${formatDateTime(new Date('2026-11-22T09:40:00Z'))}`),
    ).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Play Article title 1' })).toBeVisible();
    const unvisited = screen.getByText('Article title 2').closest('article') as HTMLElement;
    expect(within(unvisited).queryByText(/Last visited/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeVisible();
    expect(playAll()).toBeEnabled();
  });

  it('says there are no articles yet and turns Play all off', async () => {
    answer(() => batch({ items: [] }));

    await openList();

    expect(await screen.findByText('No articles yet.')).toBeVisible();
    expect(screen.getByText('0 articles')).toBeVisible();
    expect(playAll()).toBeDisabled();
  });

  it('shows a failed first batch in place of the list, without a count, and retries it', async () => {
    let failing = true;
    answer(() =>
      failing ? json(503, errorBody('UNAVAILABLE', true)) : batch({ items: items(1, 1) }),
    );

    await openList();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load articles.Retry");
    expect(screen.queryByText(/\d+ articles?$/)).toBeNull();
    expect(playAll()).toBeDisabled();

    failing = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('1 article')).toBeVisible();
  });
});

describe('batches', () => {
  it('loads the next batch with the cursor, says so and moves the focus to it', async () => {
    answer((params) =>
      params.get('cursor') === 'second'
        ? batch({ items: items(21, 3), totalCount: 23 })
        : batch({ items: items(1, 20), nextCursor: 'second', totalCount: 23 }),
    );
    await openList();

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('More records loaded.')).toBeVisible();
    expect(lastRequest()).toMatchObject({ cursor: 'second' });
    expect(screen.getByText('All loaded')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(23);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Article title 21' })),
    );
  });

  it('keeps the loaded batch when the next fails, and retries in the place of Load more', async () => {
    let failing = true;
    answer((params) => {
      if (!params.get('cursor')) {
        return batch({ items: items(1, 20), nextCursor: 'second', totalCount: 21 });
      }
      return failing ? json(500, errorBody('INTERNAL', true)) : batch({ items: items(21, 1) });
    });
    await openList();

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load more articles.Retry");
    expect(screen.getAllByRole('article')).toHaveLength(20);

    failing = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Article title 21')).toBeVisible();
  });
});

describe('search, filters and sort', () => {
  it('searches the text without the spaces at its ends and says when nothing matches', async () => {
    answer((params) => batch({ items: params.get('q') ? [] : items(1, 2) }));
    await openList();
    await screen.findByText('2 articles');

    const search = screen.getByRole('textbox', { name: 'Search article text' });
    expect(search).toHaveAttribute('maxlength', '200');
    await userEvent.fill(search, '  volcano  ');
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByText('No articles match.')).toBeVisible();
    expect(lastRequest()).toMatchObject({ q: 'volcano' });
  });

  it('applies the Source filter and names it on the highlighted button', async () => {
    answer(() => batch({ items: items(1, 2) }));
    await openList();
    await screen.findByText('2 articles');

    await userEvent.click(screen.getByRole('button', { name: 'Filter Source' }));
    const panel = screen.getByRole('dialog', { name: 'Filter Source' });
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'NASA Technology' }));
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'NIST News' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Apply' }));

    const filter = screen.getByRole('button', {
      name: 'Filter Source, NASA Technology, NIST News',
    });
    expect(filter).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(listRequests.at(-1)?.getAll('feed')).toEqual(['nasa-technology', 'nist-news']),
    );
  });

  it('applies the Category filter and keeps it when the panel closes without Apply', async () => {
    answer(() => batch({ items: items(1, 2) }));
    await openList();
    await screen.findByText('2 articles');

    await userEvent.click(screen.getByRole('button', { name: 'Filter Category' }));
    let panel = screen.getByRole('dialog', { name: 'Filter Category' });
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Health' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(listRequests.at(-1)?.getAll('category')).toEqual(['health']));
    const requestsBefore = listRequests.length;

    await userEvent.click(screen.getByRole('button', { name: 'Filter Category, Health' }));
    panel = screen.getByRole('dialog', { name: 'Filter Category' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Clear' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Close filter' }));

    expect(screen.getByRole('button', { name: 'Filter Category, Health' })).toBeVisible();
    expect(listRequests).toHaveLength(requestsBefore);
  });

  it('treats choosing every source as no filter', async () => {
    answer(() => batch({ items: items(1, 2) }));
    await openList();
    await screen.findByText('2 articles');

    await userEvent.click(screen.getByRole('button', { name: 'Filter Source' }));
    const panel = screen.getByRole('dialog', { name: 'Filter Source' });
    for (const box of within(panel).getAllByRole('checkbox')) {
      await userEvent.click(box);
    }
    await userEvent.click(within(panel).getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('button', { name: 'Filter Source' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('sorts by the chosen field and direction at once', async () => {
    answer(() => batch({ items: items(1, 2) }));
    await openList();
    await screen.findByText('2 articles');

    await userEvent.click(screen.getByRole('button', { name: 'Sort by Collected, descending' }));
    const panel = screen.getByRole('dialog', { name: 'Sort' });
    await userEvent.click(within(panel).getByRole('radio', { name: 'Article' }));
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({ sort: 'article', direction: 'desc' }),
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Ascending' }));

    await waitFor(() => expect(lastRequest()).toMatchObject({ sort: 'article', direction: 'asc' }));
    expect(within(panel).getByRole('button', { name: 'Ascending' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Sort by Article, ascending' })).toBeVisible();
  });
});

describe('playing from the list', () => {
  it('plays all articles of the query from the first', async () => {
    answer(() => batch({ items: items(1, 3) }), ['article-1', 'article-2', 'article-3']);
    await openList();
    await screen.findByText('3 articles');

    await userEvent.click(playAll());

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/articles/article-1'));
    expect(usePlayerStore.getState()).toMatchObject({
      queue: ['article-1', 'article-2', 'article-3'],
      queueIndex: 0,
      autoplay: 'article-1',
    });
  });

  it('plays from an article and the ones after it', async () => {
    answer(() => batch({ items: items(1, 3) }), ['article-1', 'article-2', 'article-3']);
    await openList();

    await userEvent.click(await screen.findByRole('button', { name: 'Play Article title 2' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/articles/article-2'));
    expect(usePlayerStore.getState().queue).toEqual(['article-2', 'article-3']);
  });

  it('stops playback and clears the queue when a card is opened', async () => {
    answer(() => batch({ items: items(1, 2) }));
    usePlayerStore.setState({ queue: ['article-1', 'article-2'], queueIndex: 0 });
    await openList();

    await userEvent.click(await screen.findByText('First sentence of article 2.'));

    expect(router.push).toHaveBeenCalledWith('/articles/article-2');
    expect(usePlayerStore.getState().queue).toBeNull();
  });
});
