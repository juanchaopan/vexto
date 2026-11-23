// Saving an explanation (.docs/design/screens.md, 保存到生词本, screens 28–29 and 58–59) through
// the saver the host provides, against a stand-in for the vocabulary endpoints: a saved word, a
// failed save with Retry, the replace question with Cancel and Replace, a failed replacement whose
// notice stays usable over the dialog, and a card changed on another device.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  onSavedWord,
  useWordSaver,
  type SavableLookup,
  type WordSaver,
} from '../../../lib/ui/lookup-bridge.ts';
import { dismissToast } from '../../../lib/ui/toast.tsx';
import {
  cardDetail,
  errorBody,
  json,
  renderWithCache,
  standIn,
  type Route,
  type SentRequest,
} from './testing.tsx';
import { WordSaverHost } from './word-saver.tsx';

vi.mock('next/navigation', () => ({
  usePathname: () => '/articles/a',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const fetchMock = vi.spyOn(window, 'fetch');

const captured: { saver: WordSaver | null } = { saver: null };

function SaverProbe() {
  const saver = useWordSaver();
  useEffect(() => {
    captured.saver = saver;
  }, [saver]);
  return null;
}

const lookup: SavableLookup = {
  id: 'lookup-1',
  lemma: 'resilient',
  pos: 'adjective',
  meaningZh: '有韧性的；经得起损耗的',
  examples: [
    { id: 'lookup-example-1', position: 0, text: 'The new coating keeps the camera resilient.' },
    { id: 'lookup-example-2', position: 1, text: 'Resilient materials return to their shape.' },
  ],
};

const savedCard = cardDetail('card-1');

/** The saved card as a DUPLICATE_WORD answer carries it. */
const duplicateDetails = {
  id: savedCard.id,
  lemma: savedCard.lemma,
  pos: savedCard.pos,
  meaningZh: savedCard.meaningZh,
  examples: savedCard.examples,
  updatedAt: savedCard.updatedAt,
};

const announced = vi.fn();
let stopListening: () => void = () => undefined;

beforeEach(() => {
  fetchMock.mockReset();
  announced.mockReset();
  captured.saver = null;
  stopListening = onSavedWord(announced);
});

afterEach(() => {
  stopListening();
  act(() => dismissToast());
  cleanup();
});

const saves = (sent: SentRequest[]) =>
  sent.filter((request) => request.method === 'POST' && request.path === '/api/vocabulary');
const replacements = (sent: SentRequest[]) =>
  sent.filter((request) => request.path === '/api/vocabulary/card-1/replace');

function saveRoute(answer: () => Response): Route {
  return (request) =>
    request.method === 'POST' && request.path === '/api/vocabulary' ? answer() : undefined;
}

function replaceRoute(answer: () => Response): Route {
  return (request) => (request.path === '/api/vocabulary/card-1/replace' ? answer() : undefined);
}

const duplicate = () =>
  json(409, errorBody('DUPLICATE_WORD', false, { savedCard: duplicateDetails }));

async function openHost(...routes: Route[]) {
  const sent = standIn(fetchMock, ...routes);
  renderWithCache(
    <>
      <WordSaverHost />
      <SaverProbe />
    </>,
  );
  await waitFor(() => expect(captured.saver).not.toBeNull());
  return sent;
}

function save(): Promise<string | null> {
  let result!: Promise<string | null>;
  act(() => {
    result = captured.saver!(lookup);
  });
  return result;
}

describe('the saver', () => {
  it('saves the explanation, says so and tells the explanation', async () => {
    const sent = await openHost(saveRoute(() => json(201, { data: cardDetail('card-9') })));

    expect(await save()).toBe('card-9');

    expect(saves(sent)[0].body).toEqual({ operationId: expect.any(String), lookupId: 'lookup-1' });
    expect(await screen.findByText('Saved to Vocabulary.')).toBeVisible();
    expect(announced).toHaveBeenCalledWith('lookup-1', 'card-9');
  });

  it('offers Retry when saving fails, which sends the same operation and marks it saved', async () => {
    let fail = true;
    const sent = await openHost(
      saveRoute(() =>
        fail
          ? json(503, errorBody('UNAVAILABLE', true))
          : json(201, { data: cardDetail('card-9') }),
      ),
    );

    expect(await save()).toBeNull();
    expect(await screen.findByText("Couldn't save the word.")).toBeVisible();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(announced).toHaveBeenCalledWith('lookup-1', 'card-9'));
    expect(saves(sent)).toHaveLength(2);
    expect(saves(sent)[1].body).toEqual(saves(sent)[0].body);
  });

  it('shows a failure nothing can fix without Retry', async () => {
    await openHost(saveRoute(() => json(404, errorBody('NOT_FOUND'))));

    expect(await save()).toBeNull();

    expect(await screen.findByText("Couldn't save the word.")).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('says the word changed on another device when the cards changed meanwhile', async () => {
    await openHost(saveRoute(() => json(409, errorBody('CONFLICT'))));

    expect(await save()).toBeNull();

    expect(await screen.findByText('This word changed on another device.')).toBeVisible();
  });
});

describe('the replace question', () => {
  it('compares the saved and the new meaning, and Replace keeps the progress', async () => {
    const sent = await openHost(
      saveRoute(duplicate),
      replaceRoute(() => json(200, { data: cardDetail('card-1') })),
    );

    const result = save();
    const dialog = await screen.findByRole('dialog', { name: 'Replace saved word?' });
    expect(within(dialog).getByText('resilient · adjective')).toBeVisible();
    const saved = within(dialog).getByRole('region', { name: 'Saved' });
    expect(within(saved).getByText(savedCard.meaningZh)).toBeVisible();
    expect(within(saved).getByText(savedCard.examples[0].text)).toBeVisible();
    const fresh = within(dialog).getByRole('region', { name: 'New' });
    expect(within(fresh).getByText(lookup.meaningZh)).toBeVisible();
    expect(within(fresh).getByText(lookup.examples[1].text)).toBeVisible();
    expect(within(dialog).getByText('Review progress stays the same.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace' }));

    expect(await result).toBe('card-1');
    expect(replacements(sent)[0].body).toEqual({
      operationId: expect.any(String),
      lookupId: 'lookup-1',
      updatedAt: savedCard.updatedAt,
    });
    expect(
      await screen.findByText('Saved word replaced. Review progress is unchanged.'),
    ).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(announced).toHaveBeenCalledWith('lookup-1', 'card-1');
  });

  it('changes nothing on Cancel', async () => {
    const sent = await openHost(saveRoute(duplicate));

    const result = save();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(await result).toBeNull();
    expect(replacements(sent)).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open when replacing fails, with Retry usable above the backdrop', async () => {
    let fail = true;
    const sent = await openHost(
      saveRoute(duplicate),
      replaceRoute(() =>
        fail ? json(500, errorBody('INTERNAL', true)) : json(200, { data: cardDetail('card-1') }),
      ),
    );

    const result = save();
    const dialog = await screen.findByRole('dialog', { name: 'Replace saved word?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace' }));

    expect(await within(dialog).findByText("Couldn't replace the word.")).toBeVisible();
    fail = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));

    expect(await result).toBe('card-1');
    expect(replacements(sent)).toHaveLength(2);
    expect(replacements(sent)[1].body).toEqual(replacements(sent)[0].body);
  });

  it('closes when the saved card changed or went on another device', async () => {
    await openHost(
      saveRoute(duplicate),
      replaceRoute(() => json(409, errorBody('CONFLICT'))),
    );

    const result = save();
    await userEvent.click(await screen.findByRole('button', { name: 'Replace' }));

    expect(await result).toBeNull();
    expect(await screen.findByText('This word changed on another device.')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
