'use client';

// The gate in front of every page that needs a member (.docs/design/rules.md, 成员和登录 and
// 使用条款). It reads the profile: a Google account that is not an active member sees the no
// access page, a member who has not accepted the current terms sees the full-screen terms page
// whatever page was asked for, and everyone else sees the page. The server makes the same checks
// on every request; the gate only decides what to draw.
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { leavesPage } from '../../../lib/api/access-handling.ts';
import { hasErrorCode, offersRetry } from '../../../lib/api/client.ts';
import { sharedConfig } from '../../../lib/config/shared-config.ts';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { showToast } from '../../../lib/ui/toast.tsx';
import { acceptedCurrentTerms, useAcceptTerms, useLogOut, useProfile } from './account-queries.ts';
import { CenteredBody, DocPage } from './doc-page.tsx';
import { NoAccess } from './no-access.tsx';
import { TermsDocument } from './terms-document.tsx';
import { ARTICLES_PATH } from './top-bar.tsx';

function NoAccessScreen() {
  const { user } = useUser();
  const { logOut, loggingOut } = useLogOut();
  return (
    <NoAccess
      email={user?.primaryEmailAddress?.emailAddress ?? ''}
      onLogOut={() => void logOut()}
      loggingOut={loggingOut}
    />
  );
}

const ACCEPT_FAILED = "Couldn't save your answer.";

/**
 * The terms page before the first acceptance of the current version. I agree records the
 * version the page shows and opens Articles. When that version is no longer current the page
 * reloads to show the current terms; a failure the page changes for shows nothing more, and
 * other failures keep the page and say so in a notice.
 */
export function AcceptTermsScreen() {
  const router = useRouter();
  const accept = useAcceptTerms();
  const { logOut, loggingOut } = useLogOut();

  const agree = () =>
    accept.mutate(sharedConfig.terms.version, {
      onSuccess: () => router.replace(ARTICLES_PATH),
      onError: (error) => {
        if (hasErrorCode(error, 'CONFLICT')) {
          window.location.reload();
        } else if (!leavesPage(error)) {
          showToast(ACCEPT_FAILED, offersRetry(error) ? { retry: agree } : {});
        }
      },
    });

  return (
    <TermsDocument
      mode="accept"
      onAgree={agree}
      agreeing={accept.isPending}
      onLogOut={() => void logOut()}
      loggingOut={loggingOut}
    />
  );
}

function ProfileLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <DocPage>
      <CenteredBody>
        <p role="alert" className="flex items-center gap-1.5">
          <Icon name="circle-alert" />
          Couldn&apos;t load your account.
        </p>
        <Button onClick={onRetry}>
          <Icon name="refresh-cw" />
          Retry
        </Button>
      </CenteredBody>
    </DocPage>
  );
}

const blank = <div aria-busy="true" className="min-h-dvh bg-surface" />;

/**
 * A failed read of the profile hides the page only when it says who may not see it: not a
 * member, or signed out (the sign-in page is on its way). Any other failure keeps the profile
 * read before, and without one offers Retry.
 */
export function MemberGate({ children }: { children: ReactNode }) {
  const profile = useProfile();
  if (hasErrorCode(profile.error, 'NOT_A_MEMBER')) {
    return <NoAccessScreen />;
  }
  if (hasErrorCode(profile.error, 'UNAUTHENTICATED')) {
    return blank;
  }
  if (profile.data) {
    return acceptedCurrentTerms(profile.data) ? children : <AcceptTermsScreen />;
  }
  if (profile.isError) {
    return <ProfileLoadFailed onRetry={() => void profile.refetch()} />;
  }
  return blank;
}
