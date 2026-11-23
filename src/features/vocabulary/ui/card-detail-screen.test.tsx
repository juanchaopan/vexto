// Card details (.docs/design/screens.md, 词卡详情, screens 42 and 70) against stand-ins for the
// card, refresh and playback endpoints and the audio element: the lemma, meaning, examples and
// progress; looking up a word of an example; a new example, a refresh that failed or found the
// card changed; word audio that is unavailable; a card that is gone, found on loading, refreshing
// or playing; a failed load with Retry; and closing back to the list.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { provideLookup, type LookupTarget } from '../../../lib/ui/lookup-bridge.ts';
import { setSpeechElementFactory } from '../../../lib/ui/speech-audio.ts';
import { dismissToast } from '../../../lib/ui/toast.tsx';
import { clearVocabularyReturn, peekVocabularyReturn } from '../../../lib/ui/vocabulary-return.ts';
import { CardDetailScreen } from './card-detail-screen.tsx';
import {
  cardDetail,
  errorBody,
  json,
  renderWithCache,
  standIn,
  type Route,
  type SentRequest,
} from './testing.tsx';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/vocabulary/card-1',
  useRouter: () => router,
}));

const fetchMock = vi.spyOn(window, 'fetch');

const lookUp = vi.fn<(target: LookupTarget) => void>();
let removeBridge: () => void = () => undefined;

beforeEach(() => {
  fetchMock.mockReset();
  router.replace.mockReset();
  router.back.mockReset();
  lookUp.mockReset();
  clearVocabularyReturn();
  removeBridge = provideLookup({ lookUp, openSelectionTool: vi.fn() });
  // The word and example audio plays through an element that plays nothing.
  setSpeechElementFactory(() => ({
    src: '',
    play: () => Promise.resolve(),
    pause: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  removeBridge();
  act(() => dismissToast());
  cleanup();
});

const card = cardDetail('card-1');

const cardRoute =
  (answer: () => Response): Route =>
  (request) =>
    request.method === 'GET' && request.path === '/api/vocabulary/card-1' ? answer() : undefined;

const playbackRoute =
  (answer: () => Response): Route =>
  (request) =>
    request.path === '/api/media/playback' ? answer() : undefined;

const refreshes = (sent: SentRequest[]) =>
  sent.filter((request) => request.path.endsWith('/refresh'));

const playbacks = (sent: SentRequest[]) =>
  sent.filter((request) => request.path === '/api/media/playback');

async function openCard(...routes: Route[]) {
  const sent = standIn(fetchMock, ...routes);
  renderWithCache(<CardDetailScreen cardId="card-1" />);
  await waitFor(() => expect(sent.length).toBeGreaterThan(0));
  return sent;
}

function exampleText() {
  return screen.getByRole('group', { name: 'Examples' }).querySelector('[data-lookup-text]')
    ?.textContent;
}

/** Back on Vocabulary once, with the notice and the list to be read again from its top. */
async function expectBackOnVocabulary() {
  expect(await screen.findByText('This word was deleted.')).toBeVisible();
  expect(router.replace).toHaveBeenCalledExactlyOnceWith('/vocabulary');
  expect(peekVocabularyReturn()).toEqual({ focus: null });
}

describe('card details', () => {
  it('show the lemma, the meaning, the first example and the progress', async () => {
    await openCard(cardRoute(() => json(200, { data: card })));

    expect(await screen.findByRole('heading', { name: 'resilient', level: 1 })).toBeVisible();
    expect(screen.getByText('adjective')).toBeVisible();
    expect(screen.getByText(card.meaningZh)).toBeVisible();
    expect(exampleText()).toBe(card.examples[0].text);
    expect(screen.getByText('1 / 2')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Spell, Round 3, Due' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Translate, Complete, —' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Play word' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('look up a tapped word of the example in the card', async () => {
    await openCard(cardRoute(() => json(200, { data: card })));
    const group = await screen.findByRole('group', { name: 'Examples' });

    await userEvent.click(within(group).getByText('city'));

    expect(lookUp).toHaveBeenCalledWith({
      context: { kind: 'vocabulary-example', cardId: 'card-1', exampleId: 'example-1' },
      contextText: card.examples[0].text,
      selection: { start: 12, end: 16 },
    });
  });

  it('put a new example in place of the shown one', async () => {
    const fresh = {
      id: 'example-9',
      position: 0,
      text: 'A resilient team recovers quickly from a bad start to the season.',
      targetRanges: [[2, 11]],
    };
    const sent = await openCard(
      cardRoute(() => json(200, { data: card })),
      (request) => (request.path.endsWith('/refresh') ? json(200, { data: fresh }) : undefined),
    );
    await screen.findByRole('group', { name: 'Examples' });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh this example' }));

    await waitFor(() => expect(exampleText()).toBe(fresh.text));
    expect(refreshes(sent)[0].path).toBe('/api/vocabulary/card-1/examples/example-1/refresh');
  });

  it('keep the example when refreshing fails, and Retry sends the same operation', async () => {
    const sent = await openCard(
      cardRoute(() => json(200, { data: card })),
      (request) =>
        request.path.endsWith('/refresh') ? json(503, errorBody('UNAVAILABLE', true)) : undefined,
    );
    await screen.findByRole('group', { name: 'Examples' });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh this example' }));
    expect(await screen.findByText("Couldn't get a new example.")).toBeVisible();
    expect(exampleText()).toBe(card.examples[0].text);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(refreshes(sent)).toHaveLength(2));
    expect(refreshes(sent)[1].body).toEqual(refreshes(sent)[0].body);
  });

  it('read the card again when another device changed it', async () => {
    const sent = await openCard(
      cardRoute(() => json(200, { data: card })),
      (request) =>
        request.path.endsWith('/refresh') ? json(409, errorBody('CONFLICT')) : undefined,
    );
    await screen.findByRole('group', { name: 'Examples' });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh this example' }));

    expect(await screen.findByText('This word changed on another device.')).toBeVisible();
    await waitFor(() =>
      expect(sent.filter((request) => request.path === '/api/vocabulary/card-1')).toHaveLength(2),
    );
  });

  it('say the word audio is not available, and Retry asks for the same audio again', async () => {
    const sent = await openCard(
      cardRoute(() => json(200, { data: card })),
      playbackRoute(() => json(503, errorBody('UNAVAILABLE', true))),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Play word' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Audio isn't available right now.Retry");
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(playbacks(sent)).toHaveLength(2));
    expect(playbacks(sent)[1].body).toEqual({ kind: 'card-word', cardId: 'card-1' });
    expect(playbacks(sent)[0].body).toEqual(playbacks(sent)[1].body);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('go back to Vocabulary with a notice when the card is gone', async () => {
    await openCard(cardRoute(() => json(404, errorBody('NOT_FOUND'))));

    await expectBackOnVocabulary();
  });

  it('go back to Vocabulary with a notice when refreshing an example finds the card gone', async () => {
    await openCard(
      cardRoute(() => json(200, { data: card })),
      (request) =>
        request.path.endsWith('/refresh') ? json(404, errorBody('NOT_FOUND')) : undefined,
    );
    await screen.findByRole('group', { name: 'Examples' });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh this example' }));

    await expectBackOnVocabulary();
    expect(screen.queryByText("Couldn't get a new example.")).toBeNull();
  });

  it('go back to Vocabulary with a notice when the word audio finds the card gone', async () => {
    await openCard(
      cardRoute(() => json(200, { data: card })),
      playbackRoute(() => json(404, errorBody('NOT_FOUND'))),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Play word' }));

    await expectBackOnVocabulary();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('show a failed load with Retry and keep the close button', async () => {
    let fail = true;
    await openCard(
      cardRoute(() => (fail ? json(500, errorBody('INTERNAL', true)) : json(200, { data: card }))),
    );

    expect(await screen.findByText("Couldn't load this word.")).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Close word and return to Vocabulary' }),
    ).toBeVisible();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'resilient', level: 1 })).toBeVisible();
  });

  it('close back to the list, with the focus going back to this card', async () => {
    await openCard(cardRoute(() => json(200, { data: card })));

    await userEvent.click(
      await screen.findByRole('button', { name: 'Close word and return to Vocabulary' }),
    );

    expect(peekVocabularyReturn()).toEqual({
      focus: '[data-card-id="card-1"] [data-card-title]',
    });
    expect(router.replace.mock.calls.length + router.back.mock.calls.length).toBe(1);
  });
});
