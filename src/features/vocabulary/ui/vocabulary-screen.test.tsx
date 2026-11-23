// The Vocabulary screen (.docs/design/screens.md, Vocabulary, screens 30–41, 60 and 65–68)
// against stand-ins for the vocabulary and review counts endpoints: the cards with their progress,
// the count and the mode buttons; the tab, search, round filters and sort with the requests they
// send; the empty, failed and unanswered lists; selection mode, a long press, the 100-word limit
// and batch delete with its confirmation, a changed selection and a failure; a swipe uncovering
// Delete, and deleting one word that fails or was already gone; opening a card; and coming back to
// the list or starting it over.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { dismissToast } from '../../../lib/ui/toast.tsx';
import { returnToVocabulary } from '../../../lib/ui/vocabulary-return.ts';
import {
  cardItem,
  errorBody,
  freshVocabulary,
  json,
  listAnswer,
  renderWithCache,
  standIn,
  type Route,
  type SentRequest,
} from './testing.tsx';
import { VocabularyScreen } from './vocabulary-screen.tsx';
import { useVocabularyStore } from './vocabulary-store.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/vocabulary',
  useRouter: () => router,
}));

const fetchMock = vi.spyOn(window, 'fetch');

const PAST = '2026-01-01T00:00:00.000Z';

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
  freshVocabulary();
  fetchMock.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  act(() => dismissToast());
  cleanup();
});

const isList = (request: SentRequest) =>
  request.method === 'GET' && request.path === '/api/vocabulary';

function listRoute(answer: (request: SentRequest) => Response | Promise<Response>): Route {
  return (request) => (isList(request) ? answer(request) : undefined);
}

const lists = (sent: SentRequest[]) => sent.filter(isList);

async function openScreen(...routes: Route[]) {
  const sent = standIn(fetchMock, ...routes);
  renderWithCache(<VocabularyScreen />);
  await waitFor(() => expect(lists(sent).length).toBeGreaterThan(0));
  return sent;
}

const three = [cardItem(1), cardItem(2), cardItem(3)];

const noResponse = () => Promise.reject(new TypeError('Failed to fetch'));

async function card(lemma: string) {
  const title = await screen.findByRole('button', { name: lemma });
  return title.closest('article') as HTMLElement;
}

function deleteButtonOf(word: HTMLElement) {
  return word.querySelector('[data-swipe-delete]') as HTMLElement;
}

function pointer(target: Element, type: string, x: number, y = 100) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      button: 0,
      pointerType: 'touch',
    }),
  );
}

/** Drags across the card from x 300 to `to` and lets go, then waits out the quiet time. */
async function swipe(word: HTMLElement, to: number) {
  pointer(word, 'pointerdown', 300);
  pointer(word, 'pointermove', 285);
  pointer(word, 'pointermove', to);
  pointer(word, 'pointerup', to);
  await new Promise((resolve) => setTimeout(resolve, 550));
}

/** The Retry button of the notice that says deleting failed, once that notice shows. */
async function deleteFailedRetry() {
  const notice = await screen.findByText("Couldn't delete. Try again.");
  const toast = notice.closest('[role="status"]') as HTMLElement;
  return within(toast).getByRole('button', { name: 'Retry' });
}

describe('the list', () => {
  it('shows the cards with their progress, the count and the review counts', async () => {
    await openScreen(
      listRoute(() =>
        listAnswer([
          cardItem(1, {
            lemma: 'allocate',
            pos: 'verb',
            meaningZh: '分配；划拨',
            progress: {
              speak: { round: 0, dueAt: null },
              spell: { round: 2, dueAt: PAST },
              translate: { round: 7, dueAt: null },
            },
          }),
          cardItem(2),
        ]),
      ),
    );

    const allocate = await card('allocate');
    expect(screen.getByText('2 words')).toBeVisible();
    expect(screen.getByText('verb · 分配；划拨')).toBeVisible();
    expect(within(allocate).getByRole('group', { name: 'Speak, Round 1, —' })).toBeVisible();
    expect(within(allocate).getByRole('group', { name: 'Spell, Round 3, Due' })).toBeVisible();
    expect(within(allocate).getByRole('group', { name: 'Translate, Complete, —' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Spell, 3 due, 2 new' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Speak, coming soon' })).toBeDisabled();
    expect(screen.getByText('All loaded')).toBeVisible();
  });

  it('sends the tab, the search, a round filter and the sort, each from the first batch', async () => {
    const sent = await openScreen(listRoute(() => listAnswer(three)));
    await screen.findByRole('button', { name: 'word01' });

    await userEvent.click(screen.getByRole('button', { name: 'Ongoing' }));
    await waitFor(() => expect(lists(sent).at(-1)?.params.get('state')).toBe('ongoing'));

    await userEvent.fill(
      screen.getByRole('textbox', { name: 'Search words, examples, 中文' }),
      ' run ',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(lists(sent).at(-1)?.params.get('q')).toBe('run'));

    await userEvent.click(screen.getByRole('button', { name: 'Filter Spell round' }));
    const filter = screen.getByRole('dialog', { name: 'Filter Spell round' });
    await userEvent.click(within(filter).getByRole('checkbox', { name: 'Complete' }));
    await userEvent.click(within(filter).getByRole('checkbox', { name: 'Round 3' }));
    await userEvent.click(within(filter).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(lists(sent).at(-1)?.params.getAll('rounds.spell')).toEqual(['3', 'complete']),
    );
    expect(
      screen.getByRole('button', { name: 'Filter Spell round, Round 3, Complete' }),
    ).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Sort by Word, ascending' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Translate next' }));
    await waitFor(() => expect(lists(sent).at(-1)?.params.get('sort')).toBe('translateNext'));
    expect(lists(sent).every((request) => !request.params.has('cursor'))).toBe(true);
  });

  it('says the vocabulary is empty, or that nothing matches the tab or search', async () => {
    await openScreen(listRoute(() => listAnswer([])));
    expect(
      await screen.findByText('No words yet. Select a word while reading to look it up.'),
    ).toBeVisible();
    expect(screen.getByText('0 words')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(await screen.findByText('No words match.')).toBeVisible();
  });

  it('shows a failed first batch with Retry and no count, and loads again', async () => {
    let fail = true;
    await openScreen(
      listRoute(() => (fail ? json(503, errorBody('UNAVAILABLE', true)) : listAnswer(three))),
    );

    expect(await screen.findByText("Couldn't load words.")).toBeVisible();
    expect(screen.queryByText(/\d words?$/)).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'word01' })).toBeVisible();
  });

  it('shows a first batch that got no response with Retry, and loads again', async () => {
    let offline = true;
    await openScreen(listRoute(() => (offline ? noResponse() : listAnswer(three))));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load words.Retry");
    expect(screen.queryByText(/\d words?$/)).toBeNull();
    offline = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'word01' })).toBeVisible();
  });

  it('keeps the loaded cards when the next batch fails, with Retry where Load more was', async () => {
    await openScreen(
      listRoute((request) =>
        request.params.has('cursor')
          ? json(500, errorBody('INTERNAL', true))
          : listAnswer(three, 'next', 5),
      ),
    );
    await screen.findByRole('button', { name: 'word01' });

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText("Couldn't load more words.")).toBeVisible();
    expect(screen.getByRole('button', { name: 'word03' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it('opens a card’s details from its lemma', async () => {
    await openScreen(listRoute(() => listAnswer(three)));

    await userEvent.click(await screen.findByRole('button', { name: 'word02' }));

    expect(router.push).toHaveBeenCalledWith('/vocabulary/card-2');
  });
});

describe('coming back', () => {
  it('keeps the search and sort and puts the focus back on the card that was opened', async () => {
    useVocabularyStore.setState({
      query: { ...useVocabularyStore.getState().query, q: 'run', sort: 'spellRound' },
    });
    returnToVocabulary('[data-card-id="card-2"] [data-card-title]');

    const sent = await openScreen(listRoute(() => listAnswer(three)));

    await waitFor(() => expect(screen.getByRole('button', { name: 'word02' })).toHaveFocus());
    expect(lists(sent).every((request) => request.params.get('q') === 'run')).toBe(true);
    expect(lists(sent).every((request) => request.params.get('sort') === 'spellRound')).toBe(true);
  });

  it('starts over any other way, keeping only the tab and the round filters', async () => {
    const query = useVocabularyStore.getState().query;
    useVocabularyStore.setState({
      query: {
        ...query,
        state: 'new',
        q: 'run',
        sort: 'spellRound',
        direction: 'desc',
        rounds: { ...query.rounds, spell: ['2'] },
      },
    });

    const sent = await openScreen(listRoute(() => listAnswer(three)));

    await waitFor(() => expect(lists(sent).at(-1)?.params.get('sort')).toBe('word'));
    const params = lists(sent).at(-1)!.params;
    expect(params.get('q')).toBeNull();
    expect(params.get('direction')).toBe('asc');
    expect(params.get('state')).toBe('new');
    expect(params.getAll('rounds.spell')).toEqual(['2']);
  });
});

describe('selection mode', () => {
  it('chooses cards and the loaded ones, and deletes them after the confirmation', async () => {
    const sent = await openScreen(
      listRoute(() => listAnswer(three)),
      (request) => (request.path === '/api/vocabulary/bulk-delete' ? json(204) : undefined),
    );
    await screen.findByRole('button', { name: 'word01' });

    await userEvent.click(screen.getByRole('button', { name: 'Select words' }));
    expect(screen.getByRole('button', { name: 'Spell, 3 due, 2 new' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'word01' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select word03' }));
    expect(screen.getByText('2 selected')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Delete 2 selected words' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete 2 words?' });
    expect(
      within(dialog).getByText('word01, word03. Review progress will also be deleted.'),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('2 words deleted.')).toBeVisible();
    const deletion = sent.find((request) => request.path === '/api/vocabulary/bulk-delete');
    expect(deletion?.body).toEqual({ operationId: expect.any(String), ids: ['card-1', 'card-3'] });
    expect(screen.queryByRole('button', { name: 'word01' })).toBeNull();
    expect(screen.getByText('1 word')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Selected words' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'word02' })).toHaveFocus());
  });

  it('names three words and how many more in the confirmation', async () => {
    const five = [1, 2, 3, 4, 5].map((index) => cardItem(index));
    await openScreen(listRoute(() => listAnswer(five)));
    await screen.findByRole('button', { name: 'word01' });

    await userEvent.click(screen.getByRole('button', { name: 'Select words' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select loaded words' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 5 selected words' }));

    expect(
      screen.getByText('word01, word02, word03 +2. Review progress will also be deleted.'),
    ).toBeVisible();
  });

  it('refuses to choose more than 100 words', async () => {
    await openScreen(listRoute(() => listAnswer(three)));
    await screen.findByRole('button', { name: 'word01' });
    act(() =>
      useVocabularyStore.setState({
        selecting: true,
        selected: Array.from({ length: 99 }, (_, index) => `other-${index}`),
      }),
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select loaded words' }));

    expect(await screen.findByText('Select up to 100 words at a time.')).toBeVisible();
    expect(screen.getByText('99 selected')).toBeVisible();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select word01' }));
    expect(screen.getByText('100 selected')).toBeVisible();
  });

  it('starts with a long press on a card', async () => {
    await openScreen(listRoute(() => listAnswer(three)));
    const word = await card('word02');

    pointer(word, 'pointerdown', 100);
    await new Promise((resolve) => setTimeout(resolve, 600));
    pointer(word, 'pointerup', 100);

    expect(await screen.findByText('1 word selected.')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Select word02' })).toBeChecked();
    expect(screen.getByText('1 selected')).toBeVisible();
  });

  it('takes out the words that are gone and keeps the rest chosen when the selection changed', async () => {
    await openScreen(
      listRoute(() => listAnswer(three)),
      (request) =>
        request.path === '/api/vocabulary/bulk-delete'
          ? json(409, errorBody('SELECTION_CHANGED', false, { missingIds: ['card-1'] }))
          : undefined,
    );
    await screen.findByRole('button', { name: 'word01' });
    await userEvent.click(screen.getByRole('button', { name: 'Select words' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select word01' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select word02' }));

    await userEvent.click(screen.getByRole('button', { name: 'Delete 2 selected words' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Some words changed. Check your selection.')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'word01' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select word02' })).toBeChecked();
    expect(screen.getByText('1 selected')).toBeVisible();
  });

  it('keeps the selection when deleting fails, and Retry sends the same operation', async () => {
    let fail = true;
    const sent = await openScreen(
      listRoute(() => listAnswer(three)),
      (request) => {
        if (request.path !== '/api/vocabulary/bulk-delete') {
          return undefined;
        }
        return fail ? json(503, errorBody('UNAVAILABLE', true)) : json(204);
      },
    );
    await screen.findByRole('button', { name: 'word01' });
    await userEvent.click(screen.getByRole('button', { name: 'Select words' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select loaded words' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 3 selected words' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText("Couldn't delete. Try again.")).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('3 selected')).toBeVisible();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('3 words deleted.')).toBeVisible();
    const deletions = sent.filter((request) => request.path === '/api/vocabulary/bulk-delete');
    expect(deletions).toHaveLength(2);
    expect(deletions[1].body).toEqual(deletions[0].body);
  });
});

describe('a swipe', () => {
  it('uncovers Delete, which deletes the one word after the confirmation', async () => {
    const sent = await openScreen(
      listRoute(() => listAnswer(three)),
      (request) => (request.method === 'DELETE' ? json(204) : undefined),
    );
    const word = await card('word02');
    expect(deleteButtonOf(word)).toHaveAttribute('inert');

    await swipe(word, 220);

    await waitFor(() => expect(deleteButtonOf(word)).not.toHaveAttribute('inert'));
    await userEvent.click(within(word).getByRole('button', { name: 'Delete word02' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete word?' });
    expect(within(dialog).getByText('word02. Review progress will also be deleted.')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('1 word deleted.')).toBeVisible();
    const deletion = sent.find((request) => request.method === 'DELETE');
    expect(deletion?.path).toBe('/api/vocabulary/card-2');
    expect(deletion?.body).toEqual({ operationId: expect.any(String) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'word03' })).toHaveFocus());
  });

  it('springs back when let go before 35 pixels, and a press then covers an open one', async () => {
    await openScreen(listRoute(() => listAnswer(three)));
    const word = await card('word02');

    await swipe(word, 275);
    expect(deleteButtonOf(word)).toHaveAttribute('inert');

    await swipe(word, 200);
    await waitFor(() => expect(deleteButtonOf(word)).not.toHaveAttribute('inert'));
    await userEvent.click(screen.getByRole('button', { name: 'word01' }));
    await waitFor(() => expect(deleteButtonOf(word)).toHaveAttribute('inert'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('keeps the word when deleting fails or gets no response, and Retry sends the same operation', async () => {
    const answers = [() => json(503, errorBody('UNAVAILABLE', true)), noResponse, () => json(204)];
    const sent = await openScreen(
      listRoute(() => listAnswer(three)),
      (request) => (request.method === 'DELETE' ? answers.shift()?.() : undefined),
    );
    const deletions = () => sent.filter((request) => request.method === 'DELETE');
    const word = await card('word02');
    await swipe(word, 200);
    await userEvent.click(await within(word).findByRole('button', { name: 'Delete word02' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const retry = await deleteFailedRetry();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'word02' })).toBeVisible();
    expect(screen.getByText('3 words')).toBeVisible();
    await userEvent.click(retry);

    await waitFor(() => expect(deletions()).toHaveLength(2));
    const retryAgain = await deleteFailedRetry();
    expect(screen.getByRole('button', { name: 'word02' })).toBeVisible();
    await userEvent.click(retryAgain);

    expect(await screen.findByText('1 word deleted.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'word02' })).toBeNull();
    expect(deletions()).toHaveLength(3);
    expect(deletions()[1].body).toEqual(deletions()[0].body);
    expect(deletions()[2].body).toEqual(deletions()[0].body);
  });

  it('treats a word already deleted elsewhere as deleted, without a notice', async () => {
    await openScreen(
      listRoute(() => listAnswer(three)),
      (request) => (request.method === 'DELETE' ? json(404, errorBody('NOT_FOUND')) : undefined),
    );
    const word = await card('word01');
    await swipe(word, 200);

    await userEvent.click(await within(word).findByRole('button', { name: 'Delete word01' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'word01' })).toBeNull());
    expect(screen.queryByText('1 word deleted.')).toBeNull();
  });
});
