// Where text chosen for a lookup goes (.docs/design/screens.md, 选词). A screen that shows text a
// person can look up, such as the reader, card details or a review question, turns a tapped word
// or a finished selection into a lookup target and hands it here; the lookup part of the interface
// provides the bridge that opens the explanation. Saving an explanation to the vocabulary goes the
// other way: the vocabulary part provides the saver the explanation's Add word button calls, and
// announces every explanation it saved, also one saved later by a Retry, so the explanation shows
// the check. The parts never import each other: features reach each other in the browser only
// through lib. Without a bridge nothing is looked up; without a saver nothing can be saved.
import { useSyncExternalStore } from 'react';

/** An example a lookup can be made in, named as `POST /api/lookups` takes it. */
export type ExampleLookupContext =
  | { kind: 'lookup-example'; lookupId: string; exampleId: string }
  | { kind: 'vocabulary-example'; cardId: string; exampleId: string }
  | { kind: 'spell-example'; cardId: string; exampleId: string };

/** Where the selected text sits, as `POST /api/lookups` takes it (.docs/design/interfaces.md). */
export type LookupContext =
  | { kind: 'article'; articleId: string; firstSentence: number; lastSentence: number }
  | ExampleLookupContext;

export type LookupTarget = {
  context: LookupContext;
  /**
   * The context's text as the screen shows it: an article's sentences joined by one space inside
   * a paragraph and two line feeds between paragraphs, or the whole example. Only the selection's
   * place in it is sent; the server rebuilds the text itself.
   */
  contextText: string;
  /** The selection's place in the context text, UTF-16 offsets, end exclusive. */
  selection: { start: number; end: number };
};

export type SelectableSentence = { index: number; paragraphIndex: number; text: string };

/** A part of an example that can be chosen from, at its place in the whole example. */
export type TextSegment = { start: number; text: string };

/** What the Select words helper chooses from, next to the button that opened it. */
export type SelectionToolRequest = {
  anchor: HTMLElement;
  context:
    | { kind: 'article'; articleId: string; sentences: readonly SelectableSentence[] }
    | {
        kind: 'example';
        lookup: ExampleLookupContext;
        text: string;
        /** The parts to choose from, such as the two sides of a Spell blank; the whole by default. */
        segments?: readonly TextSegment[];
      };
};

export type LookupBridge = {
  lookUp(target: LookupTarget): void;
  openSelectionTool(request: SelectionToolRequest): void;
};

/** The explanation the Add word button saves. */
export type SavableLookup = {
  id: string;
  lemma: string;
  pos: string;
  meaningZh: string;
  examples: readonly { id: string; position: number; text: string }[];
};

/**
 * Saves an explanation to the vocabulary and resolves to the saved card's ID, or to null when it
 * was not saved (such as a replacement the person cancelled, or a failure). The saver shows its
 * own notices and dialogs; a rejection is treated like null.
 */
export type WordSaver = (lookup: SavableLookup) => Promise<string | null>;

/** Told that the explanation with this lookup ID is saved as this card. */
export type SavedWordListener = (lookupId: string, cardId: string) => void;

function slot<T>() {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    provide(next: T): () => void {
      value = next;
      notify();
      return () => {
        if (value === next) {
          value = null;
          notify();
        }
      };
    },
    current: (): T | null => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const bridgeSlot = slot<LookupBridge>();
const saverSlot = slot<WordSaver>();
const savedWordListeners = new Set<SavedWordListener>();

/** Makes `next` the bridge lookups go through; the returned function takes it away again. */
export function provideLookup(next: LookupBridge): () => void {
  return bridgeSlot.provide(next);
}

/** The bridge lookups go through, or null while no lookup is provided. */
export function currentLookup(): LookupBridge | null {
  return bridgeSlot.current();
}

/** The current bridge, followed as it is provided and taken away. */
export function useLookupBridge(): LookupBridge | null {
  return useSyncExternalStore(bridgeSlot.subscribe, bridgeSlot.current, () => null);
}

/** Makes `next` the saver of explanations; the returned function takes it away again. */
export function provideWordSaver(next: WordSaver): () => void {
  return saverSlot.provide(next);
}

/** The current saver, followed as it is provided and taken away. */
export function useWordSaver(): WordSaver | null {
  return useSyncExternalStore(saverSlot.subscribe, saverSlot.current, () => null);
}

/** Tells the explanations on screen that this lookup is saved as this card. */
export function announceSavedWord(lookupId: string, cardId: string): void {
  for (const listener of savedWordListeners) {
    listener(lookupId, cardId);
  }
}

/** Listens for saved explanations; the returned function stops listening. */
export function onSavedWord(listener: SavedWordListener): () => void {
  savedWordListeners.add(listener);
  return () => {
    savedWordListeners.delete(listener);
  };
}
