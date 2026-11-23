'use client';

// The terms opened from the account menu (.docs/design/terms.md, 从账号菜单打开时): read-only,
// with the date the member accepted them. It sits behind the member gate, so the profile shows
// the current version accepted; the close button goes back to the screen that opened the page,
// or to Articles when the page was opened directly.
import { useCloseTo } from '../../../lib/ui/navigation-history.tsx';
import { useProfile } from './account-queries.ts';
import { TermsDocument } from './terms-document.tsx';
import { ARTICLES_PATH } from './top-bar.tsx';

export function ReadOnlyTermsScreen() {
  const profile = useProfile();
  const close = useCloseTo(ARTICLES_PATH);
  const acceptedAt = profile.data?.terms.acceptedAt;
  if (!acceptedAt) {
    return null;
  }
  return <TermsDocument mode="read-only" acceptedAt={new Date(acceptedAt)} onClose={close} />;
}
