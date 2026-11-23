'use client';

// What every page of the application runs inside: the cache of server data, the notices and the
// page history. Requests are not retried on their own: a failure shows a Retry button where the
// design has one.
//
// The query client answers access errors by the rule of src/lib/api/access-handling.ts, which
// reads and writes share; this part says how each answer is done. The session that Clerk keeps
// on the page (`window.Clerk`) is asked for a fresh token, the sign-in page is loaded in full, and
// NOT_A_MEMBER or TERMS_REQUIRED make the profile be read again, so the member gate shows the no
// access page or the terms page (.docs/design/screens.md, 错误的显示).
import { QueryClientProvider } from '@tanstack/react-query';
import { Suspense, useState, type ReactNode } from 'react';
import { createAccessHandledClient, type AnyQuery } from '../../../lib/api/access-handling.ts';
import { NavigationHistory } from '../../../lib/ui/navigation-history.tsx';
import { ToastViewport } from '../../../lib/ui/toast.tsx';
import { meQueryKey, SIGN_IN_PATH } from './account-queries.ts';

/** Asks the signed-in session for a fresh token; true when the session is alive. */
async function renewSession(): Promise<boolean> {
  const session = window.Clerk?.session;
  return Boolean(session && (await session.getToken({ skipCache: true })));
}

function isProfileQuery(query: AnyQuery | null) {
  return query?.queryKey.length === meQueryKey.length && query.queryKey[0] === meQueryKey[0];
}

function createQueryClient() {
  const queryClient = createAccessHandledClient(
    {
      renewSession,
      openSignIn: () => window.location.assign(SIGN_IN_PATH),
      // The refused profile read itself already tells the member gate what to show.
      accessChanged: (query) => {
        if (!isProfileQuery(query)) {
          void queryClient.invalidateQueries({ queryKey: meQueryKey });
        }
      },
    },
    {
      queries: { retry: false, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  );
  return queryClient;
}

// The notices and the page history follow the current path, which is known only at request time
// on dynamic routes, so they render behind a Suspense boundary of their own and never hold up
// the page.
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Suspense fallback={null}>
        <ToastViewport />
        <NavigationHistory />
      </Suspense>
    </QueryClientProvider>
  );
}
