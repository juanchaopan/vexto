// The frame of the full-screen pages outside the application shell (.docs/design/screens.md):
// no access, terms and license. The header holds only the vexto mark and, where the page can be
// closed, a close button at the top right; buttons the page keeps at hand sit in a footer fixed
// to the bottom.
import type { ReactNode } from 'react';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { Brand } from './brand.tsx';

export type DocPageProps = {
  /** The close button's accessible name and action; without it the page has no close button. */
  close?: { label: string; onClose: () => void };
  /** Buttons fixed to the bottom of the screen. */
  actions?: ReactNode;
  children: ReactNode;
};

export function DocPage({ close, actions, children }: DocPageProps) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[600px] flex-col bg-surface">
      <header className="flex min-h-[69px] items-center justify-between gap-2.5 border-b border-line px-3 pt-4 pb-[9px]">
        <Brand />
        {close ? (
          <Button variant="flat" shape="icon" aria-label={close.label} onClick={close.onClose}>
            <Icon name="x" />
          </Button>
        ) : null}
      </header>
      {children}
      {actions ? (
        <div className="sticky bottom-0 flex gap-2.5 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] [&>*]:flex-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** The body of a document page: running text with headings. */
export function DocBody({ children }: { children: ReactNode }) {
  return (
    <main className="flex-1 px-4 pt-[18px] pb-6 text-sm/[1.6] [&_h1]:mb-1 [&_h1]:text-[22px] [&_h1]:font-semibold [&_h1]:tracking-[-0.3px] [&_h2]:mt-5 [&_h2]:mb-1.5 [&_h2]:text-[15px] [&_h2]:font-semibold [&_p]:my-2">
      {children}
    </main>
  );
}

/** A page whose few lines stand in the middle of the screen, as the no access page. */
export function CenteredBody({ children }: { children: ReactNode }) {
  return (
    <main className="grid flex-1 content-center justify-items-center gap-3.5 px-4 py-6 text-center [&_h1]:text-[22px] [&_h1]:font-semibold [&_h1]:tracking-[-0.3px] [&_p]:max-w-[320px] [&_p]:text-muted">
      {children}
    </main>
  );
}
