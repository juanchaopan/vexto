'use client';

// A modal dialog of the vocabulary (.docs/design/screens.md, 浮层和对话框): the delete confirmation
// and the replace question. It opens with `showModal()` over a translucent backdrop, so the rest
// of the page is inert and a notice is drawn inside it, and the focus starts on Cancel. Escape is
// Cancel; it is kept from also closing an explanation underneath. No animation.
import { useEffect, useRef, type ReactNode } from 'react';
import { Button, buttonClassName } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';

export type ModalDialogProps = {
  title: string;
  onCancel: () => void;
  children: ReactNode;
  /** The main action's button. */
  action: ReactNode;
};

export function ModalDialog({ title, onCancel, children, action }: ModalDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      element.showModal();
      cancel.current?.focus();
    }
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      className="m-auto w-[min(380px,calc(100%-30px))] rounded-[7px] border border-line bg-surface p-5 text-[13px] text-ink shadow-[0_16px_60px_#00000040] backdrop:bg-backdrop"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <h2 className="text-[17px] font-semibold">{title}</h2>
      {children}
      <div className="mt-[17px] flex justify-end gap-2">
        <button ref={cancel} type="button" className={buttonClassName()} onClick={onCancel}>
          Cancel
        </button>
        {action}
      </div>
    </dialog>
  );
}

export type DialogActionProps = {
  label: string;
  busy: boolean;
  danger?: boolean;
  onClick: () => void;
};

/** The dialog's main button; it spins and takes no second press while its request runs. */
export function DialogAction({ label, busy, danger = false, onClick }: DialogActionProps) {
  return (
    <Button
      variant={danger ? 'default' : 'primary'}
      className={danger ? 'border-danger bg-danger bg-none text-on-danger' : ''}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <Icon name="loader-circle" spin /> : null}
      {label}
    </Button>
  );
}
