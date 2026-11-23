'use client';

// The article's text in the reader (.docs/design/screens.md, 阅读页上有什么): one row per sentence
// with its own play button, more space between paragraphs, and the current sentence highlighted
// and scrolled into view as playback reaches it.
//
// Looking words up starts here (.docs/design/screens.md, 选词): a tap on a word, or a selection
// made by dragging the handles and let go, becomes a lookup target in the article's context: the
// sentences the selection touches and its place in their text. The target goes to the lookup
// bridge of src/lib/ui/lookup-bridge.ts; without a bridge nothing happens.
import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { Icon } from '../../../lib/ui/icon.tsx';
import { useLookupBridge, type LookupBridge } from '../../../lib/ui/lookup-bridge.ts';
import {
  articleSelection,
  wordPieces,
  type ReadingSentence,
  type SentencePoint,
} from '../domain/reading.ts';

export type ReaderTextProps = {
  articleId: string;
  sentences: readonly ReadingSentence[];
  /** The highlighted sentence, or null when none is. */
  active: number | null;
  selected: number | null;
  /** Whether the highlight follows playback, so it is scrolled into view. */
  following: boolean;
  onPlaySentence: (index: number) => void;
};

function sentenceRow(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return element?.closest<HTMLElement>('[data-sentence]') ?? null;
}

/** Where a point of the page's selection falls: the sentence and the offset in its text. */
function pointOf(node: Node, offset: number): SentencePoint | null {
  const row = sentenceRow(node);
  if (!row) {
    return null;
  }
  const range = document.createRange();
  range.setStart(row, 0);
  range.setEnd(node, offset);
  return { sentence: Number(row.dataset.sentence), offset: range.toString().length };
}

function lookUpRange(
  bridge: LookupBridge,
  articleId: string,
  sentences: readonly ReadingSentence[],
  anchor: SentencePoint,
  focus: SentencePoint,
) {
  const selection = articleSelection(sentences, anchor, focus);
  if (selection) {
    bridge.lookUp({
      context: {
        kind: 'article',
        articleId,
        firstSentence: selection.firstSentence,
        lastSentence: selection.lastSentence,
      },
      selection: { start: selection.start, end: selection.end },
      text: selection.text,
    });
  }
}

/** Sends a finished drag selection inside the text to the lookup bridge. */
function useSelectionLookup(
  container: RefObject<HTMLDivElement | null>,
  articleId: string,
  sentences: readonly ReadingSentence[],
  bridge: LookupBridge | null,
) {
  useEffect(() => {
    if (!bridge) {
      return;
    }
    const lookUpSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
        return;
      }
      if (!container.current?.contains(selection.anchorNode)) {
        return;
      }
      const anchor = pointOf(selection.anchorNode, selection.anchorOffset);
      const focus = pointOf(selection.focusNode, selection.focusOffset);
      if (anchor && focus) {
        lookUpRange(bridge, articleId, sentences, anchor, focus);
      }
    };
    // The selection settles after the release; read it on the next turn.
    const onRelease = () => {
      setTimeout(lookUpSelection, 0);
    };
    document.addEventListener('pointerup', onRelease);
    document.addEventListener('touchend', onRelease);
    return () => {
      document.removeEventListener('pointerup', onRelease);
      document.removeEventListener('touchend', onRelease);
    };
  }, [container, articleId, sentences, bridge]);
}

export function ReaderText({
  articleId,
  sentences,
  active,
  selected,
  following,
  onPlaySentence,
}: ReaderTextProps) {
  const container = useRef<HTMLDivElement>(null);
  const bridge = useLookupBridge();
  useSelectionLookup(container, articleId, sentences, bridge);

  useEffect(() => {
    if (!following || active === null) {
      return;
    }
    const row = container.current?.querySelector(`[data-sentence-row="${active}"]`);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [active, following]);

  const onTapWord = (event: MouseEvent<HTMLElement>) => {
    const word = (event.target as Element).closest<HTMLElement>('[data-word-start]');
    const row = sentenceRow(word);
    if (!bridge || !word || !row || !window.getSelection()?.isCollapsed) {
      return;
    }
    const sentence = Number(row.dataset.sentence);
    lookUpRange(
      bridge,
      articleId,
      sentences,
      { sentence, offset: Number(word.dataset.wordStart) },
      { sentence, offset: Number(word.dataset.wordEnd) },
    );
  };

  return (
    <div ref={container} className="px-2 py-[9px] select-text">
      {sentences.map((sentence, index) => {
        const isSelected = selected === sentence.index;
        const isActive = active === sentence.index;
        const newParagraph =
          index > 0 && sentence.paragraphIndex !== sentences[index - 1].paragraphIndex;
        return (
          <div
            key={sentence.index}
            data-sentence-row={sentence.index}
            data-active={isActive || undefined}
            className={`my-1 grid grid-cols-[44px_minmax(0,1fr)] items-start gap-[3px] rounded-[3px] px-px py-0.5 data-active:bg-soft data-active:shadow-[inset_2px_0_var(--color-accent)] ${newParagraph ? 'mt-[17px]' : ''}`}
          >
            <button
              type="button"
              className={`inline-flex min-h-11 w-11 items-center justify-center ${isActive ? 'text-accent' : 'text-muted'}`}
              aria-label={
                isSelected
                  ? `Stop sentence ${sentence.index + 1} and clear the selection`
                  : `Play sentence ${sentence.index + 1}`
              }
              onClick={() => onPlaySentence(sentence.index)}
            >
              <Icon name={isSelected ? 'square' : 'play'} />
            </button>
            <p
              data-sentence={sentence.index}
              className="py-1.5 text-base leading-[1.8]"
              onClick={onTapWord}
            >
              {wordPieces(sentence.text).map((piece, pieceIndex) =>
                piece.kind === 'word' ? (
                  <span key={pieceIndex} data-word-start={piece.start} data-word-end={piece.end}>
                    {piece.text}
                  </span>
                ) : (
                  piece.text
                ),
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
