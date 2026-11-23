'use client';

// The Select words button of a review question (.docs/design/screens.md, 选词): a text cursor
// icon that opens the Select words helper next to itself. Without a lookup provided it is
// disabled.
import { useRef } from 'react';
import { Icon } from '../../../lib/ui/icon.tsx';

export type SelectWordsButtonProps = {
  disabled: boolean;
  onOpen: (anchor: HTMLElement) => void;
};

export function SelectWordsButton({ disabled, onOpen }: SelectWordsButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={button}
      type="button"
      className="inline-flex min-h-11 w-11 items-center justify-center disabled:opacity-45"
      aria-label="Select words for lookup"
      disabled={disabled}
      onClick={() => {
        if (button.current) {
          onOpen(button.current);
        }
      }}
    >
      <Icon name="text-cursor-input" />
    </button>
  );
}
