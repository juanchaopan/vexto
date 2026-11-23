'use client';

// The frame of every screen inside the application: the top bar above the screen's content. The
// avatar shows the initials of the name on the Clerk account. The Vocabulary button counts the
// due and the new reviews of every mode that has reviews, added together (.docs/design/rules.md,
// 计数); until the counts are first known it shows none.
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useReviewCounts, type ReviewCounts as ModeCounts } from '../../../lib/ui/review-counts.ts';
import { initialsOf } from '../domain/initials.ts';
import { useLogOut } from './account-queries.ts';
import { TopBar, type ReviewCounts } from './top-bar.tsx';

export type AppShellProps = {
  children: ReactNode;
};

/** The counts of every mode added together. */
export function totalCounts(counts: ModeCounts | undefined): ReviewCounts | undefined {
  if (!counts) {
    return undefined;
  }
  const modes = Object.values(counts);
  return {
    due: modes.reduce((sum, mode) => sum + mode.due, 0),
    new: modes.reduce((sum, mode) => sum + mode.new, 0),
  };
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const { user } = useUser();
  const { logOut } = useLogOut();
  const counts = totalCounts(useReviewCounts());
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
