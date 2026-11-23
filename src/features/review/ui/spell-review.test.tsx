// The Spell review (.docs/design/screens.md, 复习 and Spell, screens 43–45, 48–50, 71–72)
// against stand-ins for the review endpoints: the question with its hidden word, an empty answer,
// right and wrong answers, the next question and the empty state, an answer sent without a
// response, changed on another device, a deleted card, a failed submit with Retry, a failed load,
// lookups beside the blank, the example audio and closing back to Vocabulary.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { takeAudioFocus } from '../../../lib/ui/audio-focus.ts';
import { provideLookup, type LookupTarget } from '../../../lib/ui/lookup-bridge.ts';
import { setSpeechElementFactory, type SpeechElement } from '../../../lib/ui/speech-audio.ts';
import { dismissToast } from '../../../lib/ui/toast.tsx';
import { clearVocabularyReturn, peekVocabularyReturn } from '../../../lib/ui/vocabulary-return.ts';
import {
  errorBody,
  json,
  renderWithCache,
  standIn,
  type Route,
} from '../../vocabulary/ui/testing.tsx';
import {
  countRequests,
  MEANING,
  nextRequests,
  nextRoute,
  noQuestionAnswer,
  noResponse,
  questionAnswer,
  resultAnswer,
  reviewPage,
  spellQuestion,
  submitRoute,
  submits,
} from './testing.tsx';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/review/spell',
  useRouter: () => router,
}));

class FakeSpeech extends EventTarget implements SpeechElement {
  src = '';
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
}

const fetchMock = vi.spyOn(window, 'fetch');
const lookUp = vi.fn<(target: LookupTarget) => void>();
let removeBridge: () => void = () => undefined;

beforeEach(() => {
  fetchMock.mockReset();
  router.replace.mockReset();
  lookUp.mockReset();
  clearVocabularyReturn();
  removeBridge = provideLookup({ lookUp, openSelectionTool: vi.fn() });
});

afterEach(() => {
  removeBridge();
  act(() => dismissToast());
  cleanup();
});

const field = () => screen.getByRole('textbox', { name: 'Your answer' });
const exampleText = () =>
  screen.getByRole('group', { name: 'Examples' }).querySelector('[data-lookup-text]');

const failingOnce = (failure: () => Response, then: () => Response) => {
  let attempts = 0;
  return () => {
    attempts += 1;
    return attempts === 1 ? failure() : then();
  };
};

async function openSpell(...routes: Route[]) {
  const sent = standIn(fetchMock, ...routes);
  renderWithCache(reviewPage('spell'));
  await waitFor(() => expect(nextRequests(sent).length).toBeGreaterThan(0));
  return sent;
}

async function openQuestion(...routes: Route[]) {
  const sent = await openSpell(
    nextRoute(() => questionAnswer(spellQuestion())),
    ...routes,
  );
  await screen.findByText(MEANING);
  return sent;
}

async function answer(text: string) {
  await userEvent.fill(field(), text);
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
}

describe('the Spell review', () => {
  it('shows the meaning, the example with a blank and the round, and pauses what plays', async () => {
    const holder = { pause: vi.fn() };
    takeAudioFocus(holder);

    await openQuestion();

    expect(screen.getByRole('heading', { name: 'Spell', level: 1 })).toBeVisible();
    expect(screen.getByText('adjective')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Hidden word' })).toBeInTheDocument();
    expect(exampleText()?.textContent).toBe('A  city can adapt to unexpected challenges.');
    expect(screen.getByText('1 / 2')).toBeVisible();
    expect(screen.getByText('Round 3')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Play the full example' })).toBeVisible();
    expect(field()).toHaveAttribute('autocapitalize', 'off');
    expect(field()).toHaveAttribute('spellcheck', 'false');
    expect(field()).toHaveAttribute('maxlength', '80');
    expect(holder.pause).toHaveBeenCalledOnce();
  });

  it('keeps the answer while the arrows change the example', async () => {
    await openQuestion();
    await userEvent.fill(field(), 'resil');

    await userEvent.click(screen.getByRole('button', { name: 'Next example' }));

    expect(exampleText()?.textContent).toBe('She remained  during a difficult first year abroad.');
    expect(field()).toHaveValue('resil');
  });

  it('asks for an answer before sending anything', async () => {
    const sent = await openQuestion();

    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Enter your answer.')).toBeVisible();
    expect(submits(sent)).toHaveLength(0);
  });

  it('shows a right answer with its wait, locks the field and asks for the counts again', async () => {
    const sent = await openQuestion(submitRoute(() => resultAnswer({ round: 3 })));
    await waitFor(() => expect(countRequests(sent)).toHaveLength(1));

    await answer('resilient');

    expect(await screen.findByText('Correct · Next review in 4 days')).toBeVisible();
    expect(field()).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Next' })).toBeVisible();
    expect(submits(sent)[0].body).toEqual({
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      cardId: 'card-1',
      mode: 'spell',
      answer: { text: 'resilient' },
    });
    await waitFor(() => expect(countRequests(sent)).toHaveLength(2));
  });

  it('shows a wrong answer with the lemma', async () => {
    await openQuestion(submitRoute(() => resultAnswer({ result: 'incorrect', round: 1 })));

    await answer('resiliant');

    expect(await screen.findByText('resilient · Try again in 10 mins')).toBeVisible();
  });

  it('says Complete when the answer completes the mode', async () => {
    await openQuestion(submitRoute(() => resultAnswer({ round: 7 })));

    await answer('resilient');

    expect(await screen.findByText('Correct · Complete')).toBeVisible();
  });

  it('asks the next question with Next and shows when the next review falls due', async () => {
    const inFourHours = new Date(Date.now() + 4 * 3_600_000 - 60_000).toISOString();
    const sent = await openSpell(
      nextRoute(
        () => questionAnswer(spellQuestion()),
        () => noQuestionAnswer(inFourHours),
      ),
      submitRoute(() => resultAnswer()),
    );
    await screen.findByText(MEANING);
    await answer('resilient');

    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));

    expect(await screen.findByText('No reviews due.')).toBeVisible();
    expect(screen.getByText('Next review in 4 hours.')).toBeVisible();
    expect(nextRequests(sent)).toHaveLength(2);
  });

  it('shows no next time when nothing will fall due', async () => {
    await openSpell(nextRoute(() => noQuestionAnswer(null)));

    expect(await screen.findByText('No reviews due.')).toBeVisible();
    expect(screen.queryByText(/Next review in/)).toBeNull();
  });

  it('keeps an answer sent without a response and sends the same operation with Retry', async () => {
    const sent = await openQuestion(submitRoute(failingOnce(noResponse, () => resultAnswer())));
    await answer('resilient');

    expect(await screen.findByText('Not saved. Reconnect to check the result.')).toBeVisible();
    expect(field()).toHaveAttribute('readonly');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Correct · Next review in 4 days')).toBeVisible();
    const [first, second] = submits(sent);
    expect(second.body).toEqual(first.body);
  });

  it('says the word changed on another device and offers Next', async () => {
    await openQuestion(submitRoute(() => json(409, errorBody('CONFLICT'))));

    await answer('resilient');

    expect(await screen.findByText('This word changed on another device.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next' })).toBeVisible();
  });

  it('says a deleted word was deleted and asks the next question', async () => {
    const sent = await openSpell(
      nextRoute(
        () => questionAnswer(spellQuestion()),
        () => noQuestionAnswer(null),
      ),
      submitRoute(() => json(404, errorBody('NOT_FOUND'))),
    );
    await screen.findByText(MEANING);

    await answer('resilient');

    expect(await screen.findByText('This word was deleted.')).toBeVisible();
    expect(await screen.findByText('No reviews due.')).toBeVisible();
    expect(nextRequests(sent)).toHaveLength(2);
  });

  it('keeps the answer open after a failed submit, and Retry sends the same answer again', async () => {
    const unavailable = () => json(503, errorBody('UNAVAILABLE', true));
    const sent = await openQuestion(submitRoute(failingOnce(unavailable, () => resultAnswer())));
    await answer('resilient');

    expect(await screen.findByText("Couldn't save your answer.")).toBeVisible();
    expect(field()).not.toHaveAttribute('readonly');
    await userEvent.fill(field(), 'resilience');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Correct · Next review in 4 days')).toBeVisible();
    expect(field()).toHaveValue('resilient');
    const [first, second] = submits(sent);
    expect(second.body).toEqual(first.body);
  });

  it('shows a failed load with Retry and asks again', async () => {
    const internal = () => json(500, errorBody('INTERNAL', true));
    await openSpell(nextRoute(failingOnce(internal, () => questionAnswer(spellQuestion()))));

    expect(await screen.findByText("Couldn't load the next review.")).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(MEANING)).toBeVisible();
  });

  it('looks up a word beside the blank in the whole example', async () => {
    await openQuestion();
    const group = screen.getByRole('group', { name: 'Examples' });

    await userEvent.click(within(group).getByText('city'));

    expect(lookUp).toHaveBeenCalledWith({
      context: { kind: 'spell-example', cardId: 'card-1', exampleId: 'example-1' },
      contextText: `A ${' '.repeat(9)} city can adapt to unexpected challenges.`,
      selection: { start: 12, end: 16 },
    });
  });

  it('refuses a selection across the blank', async () => {
    await openQuestion();
    const group = screen.getByRole('group', { name: 'Examples' });
    const before = within(group).getByText('A').firstChild as Node;
    const after = within(group).getByText('city').firstChild as Node;

    window.getSelection()?.setBaseAndExtent(before, 0, after, 4);
    document.dispatchEvent(new PointerEvent('pointerup'));

    expect(await screen.findByText('Select words on one side of the blank.')).toBeVisible();
    expect(lookUp).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
  });

  it('plays the whole example by its card and example IDs', async () => {
    const speech = new FakeSpeech();
    setSpeechElementFactory(() => speech);
    const sent = await openQuestion((request) =>
      request.path === '/api/media/playback'
        ? json(200, { data: { url: 'https://audio.test/a.mp3', expiresAt: '', durationMs: 1 } })
        : undefined,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Play the full example' }));

    await waitFor(() => expect(speech.src).toBe('https://audio.test/a.mp3'));
    expect(sent.find((request) => request.path === '/api/media/playback')?.body).toEqual({
      kind: 'card-example',
      cardId: 'card-1',
      exampleId: 'example-1',
    });
  });

  it('closes back to Vocabulary with the focus on the Spell button', async () => {
    await openQuestion();

    await userEvent.click(
      screen.getByRole('button', { name: 'Close review and return to Vocabulary' }),
    );

    expect(peekVocabularyReturn()).toEqual({ focus: '[data-review-mode="spell"]' });
    expect(router.replace).toHaveBeenCalledWith('/vocabulary');
  });
});
