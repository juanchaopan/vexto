'use client';

// The public license page `/license` (.docs/design/screens.md, 许可证). Its close button goes
// back to the screen that opened it; opened directly, it goes to Articles for someone signed in
// and to the sign-in page for everyone else.
import { useAuth } from '@clerk/nextjs';
import { useCloseTo } from '../../../lib/ui/navigation-history.tsx';
import { SIGN_IN_PATH } from './account-queries.ts';
import { LicenseDocument } from './license-document.tsx';
import { ARTICLES_PATH } from './top-bar.tsx';

export function LicenseScreen() {
  const { isSignedIn } = useAuth();
  const close = useCloseTo(isSignedIn ? ARTICLES_PATH : SIGN_IN_PATH);
  return <LicenseDocument onClose={close} />;
}
