// The Translate review (.docs/design/screens.md, Translate, screens 46–47 and 63) against
// stand-ins for the review endpoints: the lemma, the plain examples and the four options; no
// option chosen; a chosen option pressed; a right and a wrong answer with the options locked and
// the wrong choice marked; and lookups in the card's example.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { provideLookup, type LookupTarget } from '../../../lib/ui/lookup-bridge.ts';
import { dismissToast } from '../../../lib/ui/toast.tsx';
import { renderWithCache, standIn, type Route } from '../../vocabulary/ui/testing.tsx';
import {
  MEANING,
  nextRequests,
  nextRoute,
  questionAnswer,
  resultAnswer,
  reviewPage,
  submitRoute,
  submits,
  translateQuestion,
} from './testing.tsx';

vi.mock('next/navigation', () => ({
  usePathname: () => '/review/translate',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const fetchMock = vi.spyOn(window, 'fetch');
const lookUp = vi.fn<(target: LookupTarget) => void>();
let removeBridge: () => void = () => undefined;

beforeEach(() => {
  fetchMock.mockReset();
  lookUp.mockReset();
  removeBridge = provideLookup({ lookUp, openSelectionTool: vi.fn() });
});

afterEach(() => {
  removeBridge();
  act(() => dismissToast());
  cleanup();
});

const options = () => within(screen.getByRole('group', { name: 'Options' })).getAllByRole('button');
const option = (meaning: string) =>
  options().find((button) => button.textContent?.startsWith(meaning)) as HTMLElement;

async function openTranslate(...routes: Route[]) {
  const sent = standIn(
    fetchMock,
    nextRoute(() => questionAnswer(translateQuestion())),
    ...routes,
  );
  renderWithCache(reviewPage('translate'));
  await waitFor(() => expect(nextRequests(sent).length).toBeGreaterThan(0));
  await screen.findByRole('group', { name: 'Options' });
  return sent;
}

describe('the Translate review', () => {
  it('shows the lemma, the example as it is and the four options in order', async () => {
    await openTranslate();

    expect(screen.getByRole('heading', { name: 'Translate', level: 1 })).toBeVisible();
    const example = screen
      .getByRole('group', { name: 'Examples' })
      .querySelector('[data-lookup-text]');
    expect(example?.textContent).toBe('A resilient city can adapt to unexpected challenges.');
    expect(example?.querySelector('mark')).toBeNull();
    expect(options().map((one) => one.textContent)).toEqual([
      '持久的；持续很久的adjective',
      `${MEANING}adjective`,
      '准确的；精确的adjective',
      '脆弱的；易受损的adjective',
    ]);
    expect(screen.getByText('Round 3')).toBeVisible();
  });

  it('asks for an option before sending anything', async () => {
    const sent = await openTranslate();

    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Select an option.')).toBeVisible();
    expect(submits(sent)).toHaveLength(0);
  });

  it('sends the chosen option and locks the options after a right answer', async () => {
    const sent = await openTranslate(
      submitRoute(() => resultAnswer({ answer: MEANING, round: 1 })),
    );

    await userEvent.click(option(MEANING));
    expect(option(MEANING)).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Correct · Next review in 1 day')).toBeVisible();
    expect(submits(sent)[0].body).toMatchObject({
      cardId: 'card-1',
      mode: 'translate',
      answer: { optionId: 'option-2' },
    });
    for (const button of options()) {
      expect(button).toBeDisabled();
    }
  });

  it('marks a wrong choice and names the right meaning', async () => {
    await openTranslate(
      submitRoute(() => resultAnswer({ result: 'incorrect', answer: MEANING, round: 2 })),
    );

    await userEvent.click(option('持久的；持续很久的'));
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText(`${MEANING} · Try again in 10 mins`)).toBeVisible();
    const wrong = option('持久的；持续很久的');
    expect(wrong.className).toContain('text-danger');
    expect(wrong.querySelector('[data-icon="x"]')).not.toBeNull();
    expect(option(MEANING).querySelector('[data-icon="x"]')).toBeNull();
  });

  it('looks up a word of the example in the card’s example', async () => {
    await openTranslate();

    await userEvent.click(
      within(screen.getByRole('group', { name: 'Examples' })).getByText('adapt'),
    );

    expect(lookUp).toHaveBeenCalledWith({
      context: { kind: 'vocabulary-example', cardId: 'card-1', exampleId: 'example-1' },
      contextText: 'A resilient city can adapt to unexpected challenges.',
      selection: { start: 21, end: 26 },
    });
  });
});
