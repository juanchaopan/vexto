'use client';

// The avatar button at the right of the top bar and the account menu it opens
// (.docs/design/screens.md, 账号菜单): Terms, License and Log out, in a small panel right below
// the button. Pressing outside the panel or Escape closes it.
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';

export type AccountMenuProps = {
  /** The letters on the avatar button. */
  initials: string;
  onOpenTerms: () => void;
  onOpenLicense: () => void;
  onLogOut: () => void;
};

function useCloseOnOutsidePress(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);
  return ref;
}

export function AccountMenu({ initials, onOpenTerms, onOpenLicense, onLogOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useCloseOnOutsidePress(open, () => setOpen(false));
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div ref={ref} className="relative flex-none">
      <Button
        variant="flat"
        className="size-11 rounded-full! border-line! bg-page! p-0 text-xs"
        aria-label="Account menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {initials}
      </Button>
      {open ? (
        <section
          id={panelId}
          role="dialog"
          aria-label="Account"
          className="absolute top-full right-0 z-30 mt-1.5 grid w-[220px] max-w-[calc(100vw-24px)] gap-1.5 rounded-md border border-line bg-surface p-2.5 text-[13px] shadow-[0_8px_26px_#00000024] [&>button]:w-full [&>button]:justify-start"
        >
          <Button onClick={choose(onOpenTerms)}>
            <Icon name="file-text" />
            Terms
          </Button>
          <Button onClick={choose(onOpenLicense)}>
            <Icon name="scale" />
            License
          </Button>
          <Button onClick={choose(onLogOut)}>
            <Icon name="log-out" />
            Log out
          </Button>
        </section>
      ) : null}
    </div>
  );
}
