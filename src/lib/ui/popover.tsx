'use client';

// The small panels of the interface (.docs/design/screens.md, 浮层和对话框): filters, sort, speed
// and the like. A panel sits right below the button that opened it, its right edge lined up with
// the button's and kept 12 pixels inside the screen; when there is no room below it goes above.
// It is placed on the screen and follows the button when the page scrolls, so it stays next to a
// button that scrolls with the page as well as one fixed to the screen, such as the player's.
// Pressing outside the panel or Escape closes it, with no animation. The panel is drawn at the
// end of the page, so no container around the button clips it.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button.tsx';
import { Icon } from './icon.tsx';

const SCREEN_MARGIN = 12;
const GAP = 6;

type Place = { left: number; top: number; width: number };

/** Where the panel goes on the screen, for a panel of this size next to the button. */
function placeNextTo(anchor: DOMRect, width: number, height: number): Place {
  const screenWidth = document.documentElement.clientWidth;
  const fitted = Math.min(width, screenWidth - 2 * SCREEN_MARGIN);
  const left = Math.max(
    SCREEN_MARGIN,
    Math.min(anchor.right - fitted, screenWidth - fitted - SCREEN_MARGIN),
  );
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - height;
  const fitsBelow = below + height <= window.innerHeight - SCREEN_MARGIN;
  const top = fitsBelow || above < SCREEN_MARGIN ? below : above;
  return { left, top, width: fitted };
}

function samePlace(a: Place | null, b: Place) {
  return a !== null && a.left === b.left && a.top === b.top && a.width === b.width;
}

function firstControl(panel: HTMLElement): HTMLElement | null {
  return (
    panel.querySelector<HTMLElement>('input:checked') ??
    panel.querySelector<HTMLElement>('input') ??
    panel.querySelector<HTMLElement>('button')
  );
}

export type PopoverProps = {
  /** The button that opened the panel. */
  anchor: RefObject<HTMLElement | null>;
  /** The panel's accessible name. */
  label: string;
  /** The panel's width in CSS pixels, narrowed to fit the screen. */
  width: number;
  /** Closes the panel; `returnFocus` is false when the person pressed somewhere else. */
  onClose: (returnFocus: boolean) => void;
  className?: string;
  children: ReactNode;
};

/** Keeps the panel next to its button as the page scrolls or the screen changes size. */
function usePlace(
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  width: number,
) {
  const [place, setPlace] = useState<Place | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      const button = anchor.current;
      const element = panel.current;
      if (button && element) {
        const next = placeNextTo(button.getBoundingClientRect(), width, element.offsetHeight);
        setPlace((current) => (samePlace(current, next) ? current : next));
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, { capture: true });
    };
  }, [anchor, panel, width]);
  return place;
}

export function Popover({ anchor, label, width, onClose, className = '', children }: PopoverProps) {
  const panel = useRef<HTMLElement>(null);
  const place = usePlace(anchor, panel, width);

  useEffect(() => {
    if (panel.current) {
      firstControl(panel.current)?.focus();
    }
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) {
        onClose(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <section
      ref={panel}
      role="dialog"
      aria-label={label}
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        width: place?.width ?? width,
        visibility: place ? 'visible' : 'hidden',
      }}
      className={`fixed z-30 rounded-md border border-line bg-surface p-2.5 text-left text-[13px] font-normal whitespace-normal text-ink shadow-[0_8px_26px_#00000024] ${className}`}
    >
      {children}
    </section>,
    document.body,
  );
}

/** The panel's title row: the title and a close button. */
export function PopoverTitle({
  title,
  closeLabel,
  onClose,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <strong className="font-medium">{title}</strong>
      <Button variant="flat" shape="icon" aria-label={closeLabel} onClick={onClose}>
        <Icon name="x" />
      </Button>
    </div>
  );
}

/** A choice row of a panel: a checkbox or radio button and its label, 44 pixels high. */
export const choiceRowClass =
  'flex min-h-11 items-center gap-[9px] text-xs whitespace-nowrap [&>input]:m-0 [&>input]:size-4 [&>input]:flex-none [&>input]:accent-accent';

/**
 * Whether the panel of a button is open. Closing it from inside the panel gives the focus back to
 * the button; closing it by pressing elsewhere leaves the focus where the person pressed.
 */
export function usePopover(anchor: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      if (returnFocus) {
        anchor.current?.focus();
      }
    },
    [anchor],
  );
  return { open, toggle, close };
}
