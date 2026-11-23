// The explanations (.docs/design/screens.md, 查词, screens 20–27 and 56–57) against stand-ins for
// the lookup and playback endpoints and the audio element: loading, the explanation and its
// examples, failure with Retry, offline, a selection that is too long or crosses a hidden word, a
// nested lookup, a new example, word audio being made and unavailable, the saver seam and the
// Select words helper.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  currentLookup,
  provideWordSaver,
  type LookupTarget,
  type SelectionToolRequest,
} from '../../../lib/ui/lookup-bridge.ts';
import { setSpeechElementFactory, type SpeechElement } from '../../../lib/ui/speech-audio.ts';
import { dismissToast, ToastViewport } from '../../../lib/ui/toast.tsx';
import { LookupHost } from './lookup-host.tsx';
import { closeAllLayers } from './lookup-store.ts';

vi.mock('next/navigation', () => ({
  usePathname: () => '/articles/a',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const fetchMock = vi.spyOn(window, 'fetch');

type Sent = { path: string; body: Record<string, unknown> };
const sent: Sent[] = [];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorBody(code: string, retryable = false) {
  return { error: { code, message: 'Test failure.', retryable, requestId: 'req_test' } };
}

const SENTENCE = 'Engineers want equipment that is resilient enough to keep working.';
const FIRST_EXAMPLE = 'The new coating keeps the camera resilient in harsh desert conditions.';
const SECOND_EXAMPLE = 'Resilient materials return to their shape after being bent or pressed.';

function lookupResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lookup-1',
    selectedText: 'resilient',
    lemma: 'resilient',
    pos: 'adjective',
    meaningZh: '有韧性的；经得起损耗的',
    examples: [
      { id: 'example-1', position: 0, text: FIRST_EXAMPLE, targetRanges: [[33, 42]] },
      { id: 'example-2', position: 1, text: SECOND_EXAMPLE, targetRanges: [[0, 9]] },
    ],
    savedCardId: null,
    ...overrides,
  };
}

const coating = lookupResult({
  id: 'lookup-2',
  selectedText: 'coating',
  lemma: 'coating',
  pos: 'noun',
  meaningZh: '涂层；覆盖层',
});

type Handler = (body: Record<string, unknown>) => Response | Promise<Response>;

let handlers: Record<string, Handler>;

function answer(path: string, handler: Handler) {
  handlers[path] = handler;
}

/** A promise the test settles, for a request that stays pending until then. */
function deferred() {
  let settle: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

class FakeSpeech extends EventTarget implements SpeechElement {
  src = '';
  plays: string[] = [];
  play(): Promise<void> {
    if (this.src) {
      this.plays.push(this.src);
    }
    return Promise.resolve();
  }
  pause(): void {}
}

let speech: FakeSpeech;

function handlerFor(path: string): Handler {
  return (
    handlers[path] ??
    (path.endsWith('/refresh') ? handlers.refresh : undefined) ??
    (() => json(500, errorBody('INTERNAL', true)))
  );
}

beforeEach(() => {
  sent.length = 0;
  handlers = { '/api/lookups': () => json(201, { data: lookupResult() }) };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input), window.location.href);
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    sent.push({ path: url.pathname, body });
    return handlerFor(url.pathname)(body);
  });
  speech = new FakeSpeech();
  setSpeechElementFactory(() => speech);
});

afterEach(() => {
  act(() => {
    dismissToast();
    closeAllLayers();
  });
  cleanup();
});

function renderHost() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <main>
        <p>Blank page text</p>
      </main>
      <LookupHost />
      <ToastViewport />
    </QueryClientProvider>,
  );
}

function wordTarget(word = 'resilient', text = SENTENCE): LookupTarget {
  const start = text.indexOf(word);
  return {
    context: { kind: 'article', articleId: 'article-1', firstSentence: 2, lastSentence: 2 },
    contextText: text,
    selection: { start, end: start + word.length },
  };
}

function lookUp(target: LookupTarget = wordTarget()) {
  act(() => currentLookup()?.lookUp(target));
}

const layer = (name: string) => screen.getByRole('region', { name: `Explanation of ${name}` });

const noLayers = () => expect(screen.queryByRole('region', { name: /^Explanation/ })).toBeNull();

/** The explanation of the lemma, once it shows the explanation rather than its loading state. */
async function explained(name = 'resilient') {
  await waitFor(() => within(layer(name)).getByRole('button', { name: 'Play word' }));
  return layer(name);
}

/** The text of the example an explanation shows. */
function shownExample(region: HTMLElement) {
  return region.querySelector('[data-lookup-text]')?.textContent;
}

describe('an explanation', () => {
  it('appears at once while it loads, then shows the lemma, meaning and examples', async () => {
    const pending = deferred();
    answer('/api/lookups', () => pending.promise);
    renderHost();

    lookUp(wordTarget('ilien'));

    const loading = layer('resilient');
    expect(within(loading).getByText('Word explanation')).toBeVisible();
    expect(within(loading).getByRole('heading', { name: 'resilient' })).toBeVisible();
    expect(within(loading).getByText('Explaining…')).toBeVisible();
    expect(within(loading).getByRole('button', { name: 'Add word' })).toBeDisabled();
    expect(sent[0]).toEqual({
      path: '/api/lookups',
      body: {
        operationId: expect.any(String),
        context: { kind: 'article', articleId: 'article-1', firstSentence: 2, lastSentence: 2 },
        selection: { start: 33, end: 42 },
      },
    });

    pending.settle(json(201, { data: lookupResult() }));
    const ready = await explained();
    expect(within(ready).getByText('adjective')).toBeVisible();
    expect(within(ready).getByText('有韧性的；经得起损耗的')).toBeVisible();
    expect(within(ready).getByText('1 / 2')).toBeVisible();
    expect(shownExample(ready)).toBe(FIRST_EXAMPLE);
    expect(within(ready).getByText('resilient', { selector: 'mark span' })).toBeVisible();
    expect(within(ready).getByRole('button', { name: 'Previous example' })).toBeDisabled();
    expect(within(ready).getByRole('button', { name: 'Add word' })).toBeDisabled();
  });

  it('moves between the examples with a notice, without wrapping around', async () => {
    renderHost();
    lookUp();
    const ready = await explained();

    await userEvent.click(within(ready).getByRole('button', { name: 'Next example' }));

    expect(within(ready).getByText('2 / 2')).toBeVisible();
    expect(shownExample(ready)).toBe(SECOND_EXAMPLE);
    expect(within(ready).getByRole('button', { name: 'Next example' })).toBeDisabled();
    expect(await screen.findByText('Example 2 of 2')).toBeVisible();
    expect(sent).toHaveLength(1);
  });

  it('says it could not explain, and sends the same request again on Retry', async () => {
    answer('/api/lookups', () => json(503, errorBody('UNAVAILABLE', true)));
    renderHost();
    lookUp();

    const alert = await within(layer('resilient')).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't explain this.Retry");
    expect(within(layer('resilient')).getByRole('button', { name: 'Add word' })).toBeDisabled();

    answer('/api/lookups', () => json(201, { data: lookupResult() }));
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await explained();
    expect(sent[1].body.operationId).toBe(sent[0].body.operationId);
  });

  it('says the device is offline when the request gets no response', async () => {
    answer('/api/lookups', () => Promise.reject(new TypeError('Failed to fetch')));
    renderHost();
    lookUp();

    const alert = await within(layer('resilient')).findByRole('alert');
    expect(alert).toHaveTextContent("You're offline. Connect to look up words.Retry");
  });

  it('shows a failure the request cannot fix without Retry', async () => {
    answer('/api/lookups', () => json(404, errorBody('NOT_FOUND')));
    renderHost();
    lookUp();

    const alert = await within(layer('resilient')).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't explain this.");
    expect(within(alert).queryByRole('button')).toBeNull();
  });

  it('opens nothing for a selection of more than 8 words and says so', async () => {
    renderHost();

    lookUp({ ...wordTarget(), selection: { start: 0, end: SENTENCE.indexOf(' keep') + 5 } });

    expect(await screen.findByText('Select up to 8 words.')).toBeVisible();
    noLayers();
    expect(sent).toHaveLength(0);
  });

  it('closes and says so when the server finds the selection too long', async () => {
    answer('/api/lookups', () => json(422, errorBody('INVALID_INPUT')));
    renderHost();
    lookUp();

    expect(await screen.findByText('Select up to 8 words.')).toBeVisible();
    noLayers();
  });

  it('closes and says so when the server finds the selection crossing a hidden word', async () => {
    answer('/api/lookups', () => json(422, errorBody('HIDDEN_RANGE')));
    renderHost();
    lookUp();

    expect(await screen.findByText('Select words on one side of the blank.')).toBeVisible();
    noLayers();
    expect(screen.queryByText("Couldn't explain this.")).toBeNull();
  });

  it('closes with its close button, a press on a blank part of the page, or Escape', async () => {
    renderHost();
    lookUp();
    const ready = await explained();
    await userEvent.click(within(ready).getByRole('button', { name: 'Close this explanation' }));
    noLayers();

    lookUp();
    await explained();
    await userEvent.click(screen.getByText('Blank page text'));
    noLayers();

    lookUp();
    await explained();
    await userEvent.keyboard('{Escape}');
    noLayers();
  });
});

describe('a nested explanation', () => {
  it('opens on top for a word of an example, with the one below set aside', async () => {
    renderHost();
    lookUp();
    const below = await explained();
    answer('/api/lookups', () => json(201, { data: coating }));

    await userEvent.click(within(below).getByText('coating'));

    const top = await explained('coating');
    expect(sent[1].body).toMatchObject({
      context: { kind: 'lookup-example', lookupId: 'lookup-1', exampleId: 'example-1' },
      selection: { start: 8, end: 15 },
    });
    expect(below).toHaveAttribute('inert');
    expect(below.style.transform).toBe('translateX(-8px)');
    expect(top).not.toHaveAttribute('inert');

    await userEvent.click(within(top).getByRole('button', { name: 'Close this explanation' }));
    expect(layer('resilient')).not.toHaveAttribute('inert');
  });

  it('gives way to one word chosen outside the explanations', async () => {
    renderHost();
    lookUp();
    await explained();
    answer('/api/lookups', () => json(201, { data: coating }));

    lookUp(wordTarget('equipment'));

    await explained('coating');
    expect(screen.getAllByRole('region', { name: /^Explanation/ })).toHaveLength(1);
  });
});

describe('a new example', () => {
  it('replaces the shown example', async () => {
    const pending = deferred();
    answer('refresh', () => pending.promise);
    renderHost();
    lookUp();
    const ready = await explained();

    await userEvent.click(within(ready).getByRole('button', { name: 'Refresh this example' }));

    expect(sent[1].path).toBe('/api/lookups/lookup-1/examples/example-1/refresh');
    expect(within(ready).getByRole('button', { name: 'Refresh this example' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    const text = 'A resilient team keeps working when the weather turns bad.';
    pending.settle(
      json(200, { data: { id: 'example-3', position: 0, text, targetRanges: [[2, 11]] } }),
    );
    await waitFor(() => expect(shownExample(ready)).toBe(text));
    expect(within(ready).getByText('1 / 2')).toBeVisible();
  });

  it('keeps the old example when it fails, and offers Retry with the same request', async () => {
    answer('refresh', () => json(503, errorBody('UNAVAILABLE', true)));
    renderHost();
    lookUp();
    const ready = await explained();

    await userEvent.click(within(ready).getByRole('button', { name: 'Refresh this example' }));

    const notice = await screen.findByText("Couldn't get a new example.");
    expect(shownExample(ready)).toBe(FIRST_EXAMPLE);
    const toast = notice.closest('[role="status"]') as HTMLElement;
    await userEvent.click(within(toast).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2].body.operationId).toBe(sent[1].body.operationId);
  });

  it('reads the explanation again when another device changed it', async () => {
    answer('refresh', () => json(409, errorBody('CONFLICT')));
    renderHost();
    lookUp();
    const ready = await explained();

    await userEvent.click(within(ready).getByRole('button', { name: 'Refresh this example' }));

    expect(await screen.findByText('This word changed on another device.')).toBeVisible();
    await waitFor(() => expect(sent.at(-1)?.path).toBe('/api/lookups'));
    expect(sent.at(-1)?.body.operationId).not.toBe(sent[0].body.operationId);
  });
});

describe('word and example audio', () => {
  it('spins while the audio is made, then plays it', async () => {
    const pending = deferred();
    answer('/api/media/playback', () => pending.promise);
    renderHost();
    lookUp();
    const ready = await explained();

    await userEvent.click(within(ready).getByRole('button', { name: 'Play word' }));

    expect(sent[1]).toEqual({
      path: '/api/media/playback',
      body: { kind: 'lookup-word', lookupId: 'lookup-1' },
    });
    expect(within(ready).getByRole('button', { name: 'Generating word audio' })).toBeVisible();
    const url = 'https://audio.test/word.mp3';
    pending.settle(
      json(200, { data: { url, expiresAt: '2026-11-23T10:10:00.000Z', durationMs: 600 } }),
    );
    await waitFor(() => expect(speech.plays).toEqual([url]));
    expect(within(ready).getByRole('button', { name: 'Play word' })).toBeVisible();
  });

  it('says the audio is not available, with Retry', async () => {
    answer('/api/media/playback', () => json(503, errorBody('UNAVAILABLE', true)));
    renderHost();
    lookUp();
    const ready = await explained();

    await userEvent.click(within(ready).getByRole('button', { name: 'Play example' }));

    const alert = await within(ready).findByRole('alert');
    expect(alert).toHaveTextContent("Audio isn't available right now.Retry");
    expect(sent[1].body).toEqual({
      kind: 'lookup-example',
      lookupId: 'lookup-1',
      exampleId: 'example-1',
    });
  });
});

describe('saving', () => {
  it('shows the check at once for an explanation already saved', async () => {
    answer('/api/lookups', () => json(200, { data: lookupResult({ savedCardId: 'card-1' }) }));
    renderHost();
    lookUp();

    const ready = await explained();
    const saved = within(ready).getByRole('button', { name: 'Saved to Vocabulary' });
    expect(saved).toHaveAttribute('aria-pressed', 'true');
  });

  it('hands the explanation to the vocabulary’s saver and shows the check when it is saved', async () => {
    const pending = deferred();
    const saver = vi.fn(async () => {
      await pending.promise;
      return 'card-9';
    });
    const remove = provideWordSaver(saver);
    renderHost();
    lookUp();
    const ready = await explained();

    await userEvent.click(within(ready).getByRole('button', { name: 'Add word' }));

    expect(saver).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lookup-1', lemma: 'resilient' }),
    );
    expect(within(ready).getByRole('button', { name: 'Add word' })).toBeDisabled();
    pending.settle(json(200, {}));
    expect(await within(ready).findByRole('button', { name: 'Saved to Vocabulary' })).toBeVisible();
    remove();
  });
});

describe('the Select words helper', () => {
  it('looks up the chosen words of the chosen sentence', async () => {
    renderHost();
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const request: SelectionToolRequest = {
      anchor,
      context: {
        kind: 'article',
        articleId: 'article-1',
        sentences: [
          { index: 0, paragraphIndex: 0, text: 'Moon dust is fine.' },
          { index: 1, paragraphIndex: 0, text: SENTENCE },
        ],
      },
    };

    act(() => currentLookup()?.openSelectionTool(request));

    const tool = screen.getByRole('dialog', { name: 'Select words' });
    await userEvent.selectOptions(within(tool).getByRole('combobox', { name: 'Sentence' }), '1');
    await userEvent.selectOptions(within(tool).getByRole('combobox', { name: 'From' }), '5');
    const to = within(tool).getByRole('combobox', { name: 'To' });
    expect(within(to).getByRole('option', { name: 'is' })).toBeDisabled();
    await userEvent.selectOptions(to, '6');
    await userEvent.click(within(tool).getByRole('button', { name: 'Look up' }));

    expect(screen.queryByRole('dialog', { name: 'Select words' })).toBeNull();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({
      context: { kind: 'article', articleId: 'article-1', firstSentence: 1, lastSentence: 1 },
      selection: { start: 33, end: 49 },
    });
    anchor.remove();
  });
});
