// Where text chosen for a lookup goes (.docs/design/screens.md, 选词). A screen that shows text a
// person can look up, such as the reader, turns a tapped word or a finished selection into a
// lookup target and hands it here; the lookup part of the interface provides the bridge that
// opens the explanation. The two sides never import each other: features reach each other in the
// browser only through lib. Without a bridge nothing is looked up.
import { useSyncExternalStore } from 'react';

/** Where the selected text sits, as `POST /api/lookups` takes it (.docs/design/interfaces.md). */
export type LookupContext = {
  kind: 'article';
  articleId: string;
  firstSentence: number;
  lastSentence: number;
};

export type LookupTarget = {
  context: LookupContext;
  /** The selection's place in the context text, UTF-16 offsets, end exclusive. */
  selection: { start: number; end: number };
  /** The selected text, the explanation's title while it loads. */
  text: string;
};

export type SelectableSentence = { index: number; paragraphIndex: number; text: string };

/** What the Select words helper chooses from: an article's sentences, next to its button. */
export type SelectionToolRequest = {
  anchor: HTMLElement;
  context: { kind: 'article'; articleId: string; sentences: readonly SelectableSentence[] };
};

export type LookupBridge = {
  lookUp(target: LookupTarget): void;
  openSelectionTool(request: SelectionToolRequest): void;
};

let bridge: LookupBridge | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

/** Makes `next` the bridge lookups go through; the returned function takes it away again. */
export function provideLookup(next: LookupBridge): () => void {
  bridge = next;
  notify();
  return () => {
    if (bridge === next) {
      bridge = null;
      notify();
    }
  };
}

/** The bridge lookups go through, or null while no lookup is provided. */
export function currentLookup(): LookupBridge | null {
  return bridge;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current bridge, followed as it is provided and taken away. */
export function useLookupBridge(): LookupBridge | null {
  return useSyncExternalStore(subscribe, currentLookup, () => null);
}
