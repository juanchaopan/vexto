'use client';

// What every page of the application runs inside: the cache of server data, the notices and the
// page history. Any request that answers UNAUTHENTICATED opens the sign-in page; NOT_A_MEMBER and
// TERMS_REQUIRED make the profile be read again, so the member gate shows the no access page or
// the terms page (.docs/design/screens.md, 错误的显示). Requests are not retried on their own:
// a failure shows a Retry button where the design has one.
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, useState, type ReactNode } from 'react';
import { hasErrorCode } from '../../../lib/api/client.ts';
import { NavigationHistory } from '../../../lib/ui/navigation-history.tsx';
import { ToastViewport } from '../../../lib/ui/toast.tsx';
import { meQueryKey, SIGN_IN_PATH } from './account-queries.ts';

function isProfileQuery(queryKey: readonly unknown[]) {
  return queryKey.length === meQueryKey.length && queryKey[0] === meQueryKey[0];
}

function createQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({
      onError: (error, query) => onAccessError(error, isProfileQuery(query.queryKey)),
    }),
    mutationCache: new MutationCache({ onError: (error) => onAccessError(error, false) }),
  });

  function onAccessError(error: unknown, fromProfile: boolean) {
    if (hasErrorCode(error, 'UNAUTHENTICATED')) {
      window.location.assign(SIGN_IN_PATH);
    } else if (!fromProfile && hasErrorCode(error, 'NOT_A_MEMBER', 'TERMS_REQUIRED')) {
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    }
  }

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
