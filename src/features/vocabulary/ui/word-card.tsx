'use client';

// One card in the Vocabulary list (.docs/design/screens.md, Vocabulary 上有什么 and 删除词卡): the
// lemma, `<part of speech> · <meaning>` on one line and the three progress groups. The lemma is a
// button, the card's control for keyboards and screen readers; a press anywhere on the card does
// the same for touch.
//
// Gestures (手势的判定): a press held about 500 ms without moving 10 pixels is a long press. Once
// the finger moves 10 pixels the direction is settled: more than 1.3 times as far across as down
// is a swipe, anything else a scroll the browser makes. A swipe drags the front left, 0 to −80
// pixels, uncovering the red Delete button; let go past −35 pixels it stays open, otherwise it
// springs back (0.16 s, none under reduced motion). A press right after a swipe (500 ms), a scroll
// (350 ms) or a long press does not open the card. In selection mode a checkbox stands left of the
// lemma, a press chooses the card, and there is no swipe. A touch stays with the card it started
// on, so the swipe follows the finger even when it leaves the card.
import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { Icon } from '../../../lib/ui/icon.tsx';
import { ProgressGroups } from './progress-groups.tsx';
import type { CardListItem } from './vocabulary-api.ts';

const LONG_PRESS_MS = 500;
const MOVE_PX = 10;
const DIRECTION_RATIO = 1.3;
const OPEN_PX = 80;
const SETTLE_PX = 35;
const AFTER_SWIPE_MS = 500;
const AFTER_SCROLL_MS = 350;
const AFTER_LONG_PRESS_MS = 400;

/** Presses inside these are the card's own controls, not a press on the card. */
const OWN_CONTROLS = '[data-swipe-delete], label';

type Gesture = {
  x: number;
  y: number;
  pointerId: number;
  /** Undecided until the finger moved far enough; then a swipe or a scroll. */
  kind: 'pending' | 'swipe' | 'scroll';
  /** Where a swipe has dragged the front to, in pixels. */
  drag: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type GestureOptions = {
  selecting: boolean;
  open: boolean;
  onSwipe: (open: boolean) => void;
  onLongPress: () => void;
};

/** The long press, the swipe and the quiet time after them, on one card. */
function useCardGestures({ selecting, open, onSwipe, onLongPress }: GestureOptions) {
  const gesture = useRef<Gesture | null>(null);
  const quietUntil = useRef(0);
  const [drag, setDrag] = useState<number | null>(null);

  const stopTimer = () => {
    if (gesture.current?.timer) {
      clearTimeout(gesture.current.timer);
      gesture.current.timer = null;
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest(OWN_CONTROLS)) {
      return;
    }
    const timer = selecting
      ? null
      : setTimeout(() => {
          gesture.current = null;
          quietUntil.current = Number.POSITIVE_INFINITY;
          onLongPress();
        }, LONG_PRESS_MS);
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      kind: 'pending',
      drag: open ? -OPEN_PX : 0,
      timer,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    const across = event.clientX - current.x;
    const down = event.clientY - current.y;
    if (current.kind === 'pending' && Math.hypot(across, down) > MOVE_PX) {
      stopTimer();
      const swipe = !selecting && Math.abs(across) > DIRECTION_RATIO * Math.abs(down);
      current.kind = swipe ? 'swipe' : 'scroll';
    }
    if (current.kind === 'swipe') {
      current.drag = Math.min(0, Math.max(-OPEN_PX, (open ? -OPEN_PX : 0) + across));
      setDrag(current.drag);
    }
  };

  const onPointerEnd = () => {
    stopTimer();
    const current = gesture.current;
    gesture.current = null;
    const now = Date.now();
    if (quietUntil.current === Number.POSITIVE_INFINITY) {
      quietUntil.current = now + AFTER_LONG_PRESS_MS;
    }
    if (current?.kind === 'swipe') {
      onSwipe(current.drag < -SETTLE_PX);
      setDrag(null);
      quietUntil.current = now + AFTER_SWIPE_MS;
    } else if (current?.kind === 'scroll') {
      quietUntil.current = now + AFTER_SCROLL_MS;
    }
  };

  return {
    drag,
    /** Whether a press now comes too soon after a gesture to count. */
    quiet: () => Date.now() < quietUntil.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  };
}

/** Where the front of the card is: following the finger, open, or in its place. */
function frontPlace(
  drag: number | null,
  open: boolean,
): { className: string; style?: CSSProperties } {
  if (drag !== null) {
    return { className: 'transition-none!', style: { transform: `translateX(${drag}px)` } };
  }
  return open
    ? { className: '', style: { transform: `translateX(${-OPEN_PX}px)` } }
    : { className: '' };
}

export type WordCardProps = {
  card: CardListItem;
  now: Date;
  selecting: boolean;
  selected: boolean;
  /** Whether the card's Delete button is uncovered. */
  open: boolean;
  /** A press on the card or its lemma. */
  onActivate: (id: string) => void;
  /** The checkbox of selection mode. */
  onToggle: (id: string) => void;
  /** A swipe let go: uncovers this card's Delete button, or covers it again with false. */
  onSwipe: (id: string, open: boolean) => void;
  onLongPress: (id: string) => void;
  onDelete: (card: CardListItem) => void;
};

function SelectBox({
  card,
  selected,
  onToggle,
}: Pick<WordCardProps, 'card' | 'selected' | 'onToggle'>) {
  return (
    <label className="inline-flex min-h-11 w-11 flex-none items-center justify-center">
      <input
        type="checkbox"
        className="m-0 size-[17px] accent-accent"
        aria-label={`Select ${card.lemma}`}
        checked={selected}
        onChange={() => onToggle(card.id)}
      />
    </label>
  );
}

type DeleteButtonProps = { lemma: string; uncovered: boolean; onPress: () => void };

/** The red button under the card's front; out of the focus order while covered. */
function DeleteButton({ lemma, uncovered, onPress }: DeleteButtonProps) {
  return (
    <button
      type="button"
      data-swipe-delete
      inert={!uncovered}
      aria-hidden={!uncovered || undefined}
      aria-label={`Delete ${lemma}`}
      className="absolute inset-y-0 right-0 flex w-20 flex-col items-center justify-center gap-1 bg-danger text-xs font-medium text-on-danger"
      onClick={onPress}
    >
      <Icon name="trash-2" />
      Delete
    </button>
  );
}

export function WordCard(props: WordCardProps) {
  const { card, now, selecting, selected, open, onActivate, onDelete } = props;
  const swipeOpen = open && !selecting;
  const { drag, quiet, handlers } = useCardGestures({
    selecting,
    open: swipeOpen,
    onSwipe: (next) => props.onSwipe(card.id, next),
    onLongPress: () => props.onLongPress(card.id),
  });
  const front = frontPlace(drag, swipeOpen);

  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (!quiet() && !(event.target as Element).closest(OWN_CONTROLS)) {
      onActivate(card.id);
    }
  };

  return (
    <article
      data-card-id={card.id}
      className="relative touch-pan-y overflow-hidden border-b border-line bg-surface select-none [-webkit-touch-callout:none]"
      onClick={onClick}
      {...handlers}
    >
      {selecting ? null : (
        <DeleteButton
          lemma={card.lemma}
          uncovered={drag !== null || swipeOpen}
          onPress={() => onDelete(card)}
        />
      )}
      <div
        className={`relative z-[1] p-3 motion-safe:transition-transform motion-safe:duration-[160ms] motion-safe:ease-[ease] ${
          selected ? 'bg-soft' : 'bg-surface'
        } ${front.className}`}
        style={front.style}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {selecting ? <SelectBox {...props} /> : null}
          <div className="min-w-0 flex-1">
            <button
              type="button"
              data-card-title
              className="block min-h-7 max-w-full truncate p-0 text-left text-sm leading-normal font-medium text-accent"
            >
              {card.lemma}
            </button>
            <div className="truncate text-xs text-muted">
              {card.pos} · {card.meaningZh}
            </div>
          </div>
        </div>
        <ProgressGroups progress={card.progress} now={now} />
      </div>
    </article>
  );
}
