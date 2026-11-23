'use client';

// The short notice below the top bar (.docs/design/screens.md, 短提示). One notice shows at a time
// and a new one replaces it. A plain notice goes away after about 3.5 seconds; a notice with
// Retry stays until Retry is pressed, another notice replaces it or the page changes. The notice
// is an aria-live region, so screen readers read it out.
//
// While a modal dialog is open everything outside it is inert, so the notice is drawn inside the
// topmost open modal dialog: it stays above the dialog's backdrop, in the same place, and its
// Retry button can still be pressed.
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Button } from './button.tsx';
import { Icon } from './icon.tsx';

export const TOAST_DURATION_MS = 3500;

type ToastEntry = { id: number; message: string; retry?: () => void };

const useToastStore = create<{ toast: ToastEntry | null }>(() => ({ toast: null }));

let lastId = 0;

export type ToastOptions = {
  /** Shows a Retry button that runs this; the notice then stays until it is dealt with. */
  retry?: () => void;
};

/** Shows a notice, replacing the one on screen. */
export function showToast(message: string, options: ToastOptions = {}): void {
  lastId += 1;
  useToastStore.setState({ toast: { id: lastId, message, retry: options.retry } });
}

/** Removes the notice with this ID, or whichever notice shows when no ID is given. */
export function dismissToast(id?: number): void {
  useToastStore.setState((state) =>
    id === undefined || state.toast?.id === id ? { toast: null } : state,
  );
}

function topModalDialog(): HTMLDialogElement | null {
  const dialogs = [...document.querySelectorAll('dialog[open]')].filter(
    (dialog): dialog is HTMLDialogElement =>
      dialog instanceof HTMLDialogElement && dialog.matches(':modal'),
  );
  return dialogs.at(-1) ?? null;
}

/** The topmost open modal dialog, followed as dialogs open, close and leave the page. */
function useTopModalDialog() {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const update = () => setDialog(topModalDialog());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    return () => observer.disconnect();
  }, []);
  return dialog;
}

function useDismissals(toast: ToastEntry | null) {
  useEffect(() => {
    if (!toast || toast.retry) {
      return;
    }
    const timer = setTimeout(() => dismissToast(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const pathname = usePathname();
  const shownOn = useRef(pathname);
  useEffect(() => {
    if (shownOn.current === pathname) {
      return;
    }
    shownOn.current = pathname;
    const current = useToastStore.getState().toast;
    if (current?.retry) {
      dismissToast(current.id);
    }
  }, [pathname]);
}

/** The place notices appear; rendered once, in the root layout. */
export function ToastViewport() {
  const toast = useToastStore((state) => state.toast);
  const dialog = useTopModalDialog();
  useDismissals(toast);

  const retry = toast?.retry;
  const notice = (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-16 left-1/2 z-40 max-w-[min(340px,calc(100vw-24px))] -translate-x-1/2 rounded-md border border-line bg-surface text-xs text-ink shadow-[0_8px_26px_#00000024] empty:hidden ${
        retry ? 'flex w-max items-center gap-2.5 py-1 pr-1 pl-3' : 'px-3 py-2'
      }`}
    >
      {toast && retry ? (
        <>
          <span>{toast.message}</span>
          <Button
            className="flex-none"
            onClick={() => {
              dismissToast(toast.id);
              retry();
            }}
          >
            <Icon name="refresh-cw" />
            Retry
          </Button>
        </>
      ) : (
        toast?.message
      )}
    </div>
  );
  return dialog ? createPortal(notice, dialog) : notice;
}
