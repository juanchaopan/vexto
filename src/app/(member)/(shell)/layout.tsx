import type { ReactNode } from 'react';
import { AppShell } from '../../../features/account/index.ts';

// The screens with the top bar: Articles and the reader, Vocabulary, card details and reviews.
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
