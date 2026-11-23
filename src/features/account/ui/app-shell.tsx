'use client';

// The frame of every screen inside the application: the top bar above the screen's content. The
// avatar shows the initials of the name on the Clerk account.
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { initialsOf } from '../domain/initials.ts';
import { useLogOut } from './account-queries.ts';
import { TopBar, type ReviewCounts } from './top-bar.tsx';

export type AppShellProps = {
  /** The review counts on the Vocabulary button, once they are known. */
  counts?: ReviewCounts;
  children: ReactNode;
};

export function AppShell({ counts, children }: AppShellProps) {
  const router = useRouter();
  const { user } = useUser();
  const { logOut } = useLogOut();
  return (
    <div className="mx-auto min-h-dvh max-w-[600px] bg-page">
      <TopBar
        counts={counts}
        initials={initialsOf(user?.fullName, user?.primaryEmailAddress?.emailAddress)}
        onOpenTerms={() => router.push('/terms')}
        onOpenLicense={() => router.push('/license')}
        onLogOut={() => void logOut()}
      />
      {children}
    </div>
  );
}
