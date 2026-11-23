'use client';

// The examples of an explanation, a card or a review question (.docs/design/screens.md, 查词浮窗,
// 词卡详情 and 复习): the `Example` label with the buttons on its right, one example at a time
// with only the target words highlighted, and the arrows with `1 / 2` below. The first example
// disables the left arrow and the last the right one; nothing wraps around. A swipe across the
// example moves to the next or the previous one (at least 45 pixels across and 1.3 times more
// across than down, never while text is selected). Moving says `Example <n> of <N>` in a short
// notice and writes nothing.
//
// A Spell question's example comes as the parts around its hidden words: each hidden word is a
// blank line that screen readers read as `Hidden word`, and the parts keep their places in the
// whole example, so what is chosen in them is reported in the whole example's offsets.
//
// Every shown word of an example can be looked up: a tap on a word, or a selection made with the
// handles and let go, reports the range of the example's text. A tap within 400 milliseconds of
// a swipe looks nothing up; before the first swipe every tap counts, also one made right after
// the page loaded. The text is marked as lookup text, so pressing it does not count as pressing
// outside an explanation.
import {
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button } from './button.tsx';
import { Icon } from './icon.tsx';
import { showToast } from './toast.tsx';

/** A part of an example: shown text at its place in the whole example, or a hidden word. */
export type ExampleSegment = { start: number; text: string } | { gap: true };

export type CarouselExample = {
  id: string;
  text: string;
  targetRanges: readonly (readonly [start: number, end: number])[];
  /** The parts shown in place of the whole text, with blanks for hidden words. */
  segments?: readonly ExampleSegment[];
};

export type TextRangeChoice = { start: number; end: number };

export type ExampleCarouselProps = {
  examples: readonly CarouselExample[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Looks up a range of the shown example's text; nothing is looked up without it. */
  onLookUp?: (example: CarouselExample, range: TextRangeChoice) => void;
  /** What stands left of the buttons; the `Example` label by default. */
  lead?: ReactNode;
  /** The buttons on the right of the label row. */
  controls?: ReactNode;
};

const SWIPE_MIN_PX = 45;
const SWIPE_RATIO = 1.3;
const TAP_AFTER_SWIPE_MS = 400;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

type Piece = { text: string; start: number; target: boolean };

/** The example's text cut at the ends of its target ranges. */
function pieces(example: CarouselExample): Piece[] {
  const cuts = new Set([0, example.text.length]);
  for (const [start, end] of example.targetRanges) {
    cuts.add(start);
    cuts.add(end);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  return sorted.slice(0, -1).map((start, index) => ({
    text: example.text.slice(start, sorted[index + 1]),
    start,
    target: example.targetRanges.some(([from, to]) => from <= start && start < to),
  }));
}

/** A piece's words as tappable spans, with the text between them as it is. */
function words(piece: Piece): ReactNode[] {
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const match of piece.text.matchAll(WORD)) {
    if (match.index > at) {
      nodes.push(piece.text.slice(at, match.index));
    }
    const start = piece.start + match.index;
    nodes.push(
      <span key={start} data-word-start={start} data-word-end={start + match[0].length}>
        {match[0]}
      </span>,
    );
    at = match.index + match[0].length;
  }
  if (at < piece.text.length) {
    nodes.push(piece.text.slice(at));
  }
  return nodes;
}

function offsetIn(container: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(container, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** A selection end's place in the whole example, or null outside the shown text. */
function exampleOffset(node: Node, offset: number): number | null {
  const element = node instanceof Element ? node : node.parentElement;
  const segment = element?.closest<HTMLElement>('[data-segment-start]');
  if (!segment) {
    return null;
  }
  return Number(segment.dataset.segmentStart) + offsetIn(segment, node, offset);
}

/** Reports a finished selection inside the text, read on the turn after the release. */
function useSelectionRelease(
  text: RefObject<HTMLParagraphElement | null>,
  onRange: ((range: TextRangeChoice) => void) | undefined,
) {
  useEffect(() => {
    if (!onRange) {
      return;
    }
    const readSelection = () => {
      const selection = window.getSelection();
      const container = text.current;
      if (!selection || selection.isCollapsed || !container) {
        return;
      }
      const { anchorNode, focusNode } = selection;
      if (!anchorNode || !focusNode || !container.contains(anchorNode)) {
        return;
      }
      const anchor = exampleOffset(anchorNode, selection.anchorOffset);
      const focus = exampleOffset(focusNode, selection.focusOffset);
      if (anchor !== null && focus !== null) {
        onRange({ start: Math.min(anchor, focus), end: Math.max(anchor, focus) });
      }
    };
    const onRelease = () => {
      setTimeout(readSelection, 0);
    };
    document.addEventListener('pointerup', onRelease);
    document.addEventListener('touchend', onRelease);
    return () => {
      document.removeEventListener('pointerup', onRelease);
      document.removeEventListener('touchend', onRelease);
    };
  }, [text, onRange]);
}

function WholeText({ example }: { example: CarouselExample }) {
  return (
    <span data-segment-start={0}>
      {pieces(example).map((piece) =>
        piece.target ? (
          <mark key={piece.start} className="bg-soft py-px text-accent">
            {words(piece)}
          </mark>
        ) : (
          <span key={piece.start}>{words(piece)}</span>
        ),
      )}
    </span>
  );
}

function SegmentedText({ segments }: { segments: readonly ExampleSegment[] }) {
  return segments.map((segment, index) =>
    'gap' in segment ? (
      <span
        key={`gap-${index}`}
        role="img"
        aria-label="Hidden word"
        className="mx-0.5 inline-block h-5 w-[76px] rounded-xs border-b-2 border-muted bg-page align-baseline select-none"
      />
    ) : (
      <span key={segment.start} data-segment-start={segment.start}>
        {words({ text: segment.text, start: segment.start, target: false })}
      </span>
    ),
  );
}

/**
 * Whether a tap at `tappedAt` comes within the pause after the last swipe. Both are event times,
 * counted from the page's time origin, so they start near zero on a page that just loaded.
 */
function rightAfterSwipe(tappedAt: number, lastSwipeAt: number | null): boolean {
  return lastSwipeAt !== null && tappedAt - lastSwipeAt < TAP_AFTER_SWIPE_MS;
}

type ExampleTextProps = {
  example: CarouselExample;
  /** When the last swipe ended, or null before the first one. */
  lastSwipeAt: RefObject<number | null>;
  onLookUp?: (example: CarouselExample, range: TextRangeChoice) => void;
};

function ExampleText({ example, lastSwipeAt, onLookUp }: ExampleTextProps) {
  const text = useRef<HTMLParagraphElement>(null);
  useSelectionRelease(text, onLookUp ? (range) => onLookUp(example, range) : undefined);

  const onTap = (event: MouseEvent<HTMLParagraphElement>) => {
    const word = (event.target as Element).closest<HTMLElement>('[data-word-start]');
    if (
      !onLookUp ||
      !word ||
      !window.getSelection()?.isCollapsed ||
      rightAfterSwipe(event.timeStamp, lastSwipeAt.current)
    ) {
      return;
    }
    onLookUp(example, { start: Number(word.dataset.wordStart), end: Number(word.dataset.wordEnd) });
  };

  const size = example.segments ? 'text-sm leading-[1.7]' : 'text-[15px] leading-[1.8]';
  return (
    <p
      ref={text}
      data-lookup-text
      className={`col-span-3 row-start-2 min-w-0 py-1 select-text ${size}`}
      onClick={onTap}
    >
      {example.segments ? (
        <SegmentedText segments={example.segments} />
      ) : (
        <WholeText example={example} />
      )}
    </p>
  );
}

export function ExampleCarousel({
  examples,
  index,
  onIndexChange,
  onLookUp,
  lead,
  controls,
}: ExampleCarouselProps) {
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const lastSwipeAt = useRef<number | null>(null);
  const example = examples[index];

  const move = (delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < examples.length) {
      onIndexChange(next);
      showToast(`Example ${next + 1} of ${examples.length}`);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    swipeStart.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || !window.getSelection()?.isCollapsed) {
      return;
    }
    const across = event.clientX - start.x;
    const down = Math.abs(event.clientY - start.y);
    if (Math.abs(across) >= SWIPE_MIN_PX && Math.abs(across) > SWIPE_RATIO * down) {
      lastSwipeAt.current = event.timeStamp;
      move(across < 0 ? 1 : -1);
    }
  };

  if (!example) {
    return null;
  }
  return (
    <section
      role="group"
      aria-label="Examples"
      className="mt-2.5 mb-3.5 grid min-w-0 touch-pan-y grid-cols-[44px_minmax(0,1fr)_44px] gap-x-[5px]"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="col-span-3 mb-[3px] flex items-center justify-between gap-1.5">
        {lead ?? <span className="text-[11px] text-muted">Example</span>}
        <div className="flex gap-3">{controls}</div>
      </div>
      <ExampleText example={example} lastSwipeAt={lastSwipeAt} onLookUp={onLookUp} />
      <Button
        variant="flat"
        shape="icon"
        className="col-start-1 row-start-3 self-center"
        aria-label="Previous example"
        disabled={index === 0}
        onClick={() => move(-1)}
      >
        <Icon name="chevron-left" />
      </Button>
      <span
        role="status"
        aria-live="polite"
        className="col-start-2 row-start-3 self-center text-center text-[11px] whitespace-nowrap text-muted tabular-nums"
      >
        {index + 1} / {examples.length}
      </span>
      <Button
        variant="flat"
        shape="icon"
        className="col-start-3 row-start-3 self-center"
        aria-label="Next example"
        disabled={index === examples.length - 1}
        onClick={() => move(1)}
      >
        <Icon name="chevron-right" />
      </Button>
    </section>
  );
}
