// The explanations on screen (.docs/design/screens.md, 查词): a stack of layers, the top one usable
// and the ones below shifted aside. A lookup made from a screen's text replaces the stack; one
// made inside an explanation's example opens a layer on top. Before anything is asked, the
// selection grows to whole words and is checked against the limit: a longer one only says
// `Select up to 8 words.` and opens nothing.
//
// A layer appears at once while its explanation loads, then shows it, or the failure: offline
// when the request got no response, otherwise `Couldn't explain this.`; Retry sends the same
// operationId again. The requests go through the query client, so a session that ended is handled
// like on every other request. Nothing is fetched again on its own: refocusing the page or coming
// back online never calls the AI (.docs/design/rules.md, 缓存).
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { hasErrorCode, offersRetry } from '../../../lib/api/client.ts';
import type { LookupContext, LookupTarget } from '../../../lib/ui/lookup-bridge.ts';
import { showToast } from '../../../lib/ui/toast.tsx';
import {
  isRangeOf,
  selectionExtent,
  selectionProblem,
  type TextRange,
} from '../domain/selection.ts';
import {
  requestLookup,
  requestNewExample,
  type LookupExample,
  type LookupResult,
} from './lookup-api.ts';

export const TOO_LONG = 'Select up to 8 words.';
export const HIDDEN_WORD = 'Select words on one side of the blank.';
export const CHANGED = 'This word changed on another device.';
export const REFRESH_FAILED = "Couldn't get a new example.";

export type LayerStatus = 'loading' | 'ready' | 'failed' | 'offline';

export type Layer = {
  key: number;
  context: LookupContext;
  selection: TextRange;
  /** The selected text, the title while the explanation loads or after it failed. */
  title: string;
  operationId: string;
  status: LayerStatus;
  /** Whether a failure offers Retry. */
  retryable: boolean;
  result: LookupResult | null;
  exampleIndex: number;
  /** The example being replaced, or null. */
  refreshing: string | null;
};

export const useLookupStore = create<{ layers: Layer[] }>(() => ({ layers: [] }));

let queryClient: QueryClient | null = null;
let lastKey = 0;

/** Connects the lookups to the page's query client; the returned function disconnects them. */
export function connectLookups(client: QueryClient): () => void {
  queryClient = client;
  return () => {
    if (queryClient === client) {
      queryClient = null;
    }
  };
}

function changeLayer(key: number, change: (layer: Layer) => Partial<Layer>) {
  useLookupStore.setState((state) => ({
    layers: state.layers.map((layer) =>
      layer.key === key ? { ...layer, ...change(layer) } : layer,
    ),
  }));
}

function removeLayer(key: number) {
  useLookupStore.setState((state) => ({
    layers: state.layers.filter((layer) => layer.key !== key),
  }));
}

function client(): QueryClient {
  if (!queryClient) {
    throw new Error('Lookups are not connected to a query client.');
  }
  return queryClient;
}

async function fetchExplanation(layer: Layer) {
  changeLayer(layer.key, () => ({ status: 'loading' }));
  try {
    const result = await client().fetchQuery({
      queryKey: ['lookup', layer.operationId],
      queryFn: () => requestLookup(layer.context, layer.selection, layer.operationId),
      staleTime: 0,
      gcTime: 0,
    });
    changeLayer(layer.key, (current) => ({
      status: 'ready',
      result,
      exampleIndex: Math.min(current.exampleIndex, Math.max(0, result.examples.length - 1)),
    }));
  } catch (error) {
    if (hasErrorCode(error, 'INVALID_INPUT', 'HIDDEN_RANGE')) {
      removeLayer(layer.key);
      showToast(hasErrorCode(error, 'HIDDEN_RANGE') ? HIDDEN_WORD : TOO_LONG);
      return;
    }
    changeLayer(layer.key, () => ({
      status: hasErrorCode(error, 'NO_RESPONSE') ? 'offline' : 'failed',
      retryable: offersRetry(error),
    }));
  }
}

/**
 * Explains the target: in a layer on top of the explanation it was chosen in when `nested`,
 * otherwise in place of every explanation on screen.
 */
export function lookUp(target: LookupTarget, nested = false): void {
  if (!isRangeOf(target.contextText, target.selection)) {
    return;
  }
  const extent = selectionExtent(target.contextText, target.selection);
  if (!extent) {
    return;
  }
  const title = target.contextText.slice(extent.start, extent.end);
  const problem = selectionProblem(title);
  if (problem === 'too-long') {
    showToast(TOO_LONG);
    return;
  }
  if (problem) {
    return;
  }
  lastKey += 1;
  const layer: Layer = {
    key: lastKey,
    context: target.context,
    selection: extent,
    title,
    operationId: crypto.randomUUID(),
    status: 'loading',
    retryable: false,
    result: null,
    exampleIndex: 0,
    refreshing: null,
  };
  useLookupStore.setState((state) => ({ layers: nested ? [...state.layers, layer] : [layer] }));
  void fetchExplanation(layer);
}

function layerOf(key: number): Layer | undefined {
  return useLookupStore.getState().layers.find((layer) => layer.key === key);
}

/** Sends a failed explanation's request again, with the same operationId. */
export function retryLookup(key: number): void {
  const layer = layerOf(key);
  if (layer) {
    void fetchExplanation(layer);
  }
}

/** Closes the top explanation, giving the one below back its use. */
export function closeTopLayer(): void {
  useLookupStore.setState((state) => ({ layers: state.layers.slice(0, -1) }));
}

/** Closes every explanation, as leaving the screen does. */
export function closeAllLayers(): void {
  useLookupStore.setState({ layers: [] });
}

export function showExample(key: number, index: number): void {
  changeLayer(key, () => ({ exampleIndex: index }));
}

/** Records that the layer's explanation was saved as this card. */
export function markSaved(key: number, cardId: string): void {
  changeLayer(key, (layer) => ({
    result: layer.result && { ...layer.result, savedCardId: cardId },
  }));
}

function putExample(key: number, example: LookupExample) {
  changeLayer(key, (layer) => ({
    refreshing: null,
    result: layer.result && {
      ...layer.result,
      examples: layer.result.examples.map((current) =>
        current.position === example.position ? example : current,
      ),
    },
  }));
}

/** Asks for the explanation again under a new operationId, as after another device changed it. */
function reloadExplanation(key: number) {
  const layer = layerOf(key);
  if (layer) {
    const reloaded = { ...layer, operationId: crypto.randomUUID() };
    changeLayer(key, () => ({ operationId: reloaded.operationId }));
    void fetchExplanation(reloaded);
  }
}

async function sendRefresh(key: number, lookupId: string, exampleId: string, operationId: string) {
  changeLayer(key, () => ({ refreshing: exampleId }));
  try {
    const example = await client().fetchQuery({
      queryKey: ['lookup', 'refresh', operationId],
      queryFn: () => requestNewExample(lookupId, exampleId, operationId),
      staleTime: 0,
      gcTime: 0,
    });
    putExample(key, example);
  } catch (error) {
    changeLayer(key, () => ({ refreshing: null }));
    if (hasErrorCode(error, 'CONFLICT')) {
      showToast(CHANGED);
      reloadExplanation(key);
      return;
    }
    const retry = offersRetry(error)
      ? () => void sendRefresh(key, lookupId, exampleId, operationId)
      : undefined;
    showToast(REFRESH_FAILED, { retry });
  }
}

/** Replaces the shown example of the layer's explanation with a new one. */
export function refreshExample(key: number): void {
  const layer = layerOf(key);
  const example = layer?.result?.examples[layer.exampleIndex];
  if (layer?.result && example && layer.refreshing === null) {
    void sendRefresh(key, layer.result.id, example.id, crypto.randomUUID());
  }
}
