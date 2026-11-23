import { Suspense, type ReactNode } from 'react';
import { AppShell } from '../../../features/account/index.ts';
import { LookupHost } from '../../../features/lookup/index.ts';
import { PlayerHost } from '../../../features/reading/index.ts';
import { WordSaverHost } from '../../../features/vocabulary/index.ts';

// The screens with the top bar: Articles and the reader, Vocabulary, card details and reviews.
// The article player keeps playing while the person moves between them, explanations of
// looked-up words open over any of them, and an explanation can be saved to the vocabulary from
// any of them. The player and the explanations follow the current path, which is known only at
// request time, so each waits behind a Suspense boundary of its own.
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <PlayerHost />
      </Suspense>
      {children}
      <Suspense fallback={null}>
        <LookupHost />
      </Suspense>
      <WordSaverHost />
    </AppShell>
  );
}
