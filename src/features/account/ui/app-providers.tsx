'use client';

// What every page of the application runs inside: the cache of server data, the notices and the
// page history. Any request that answers UNAUTHENTICATED opens the sign-in page; NOT_A_MEMBER and
// TERMS_REQUIRED make the profile be read again, so the member gate shows the no access page or
// the terms page (.docs/design/screens.md, 错误的显示). Requests are not retried on their own:
// a failure shows a Retry button where the design has one.
//
// A request can answer UNAUTHENTICATED while the session is still alive: Clerk renews the
// one-minute session token in the browser, and a request sent while it replaces its cookies
// carries a token the server takes as outdated. So before opening the sign-in page, the session
// that Clerk keeps on the page (`window.Clerk`) is asked for a fresh token. When there is one, a
// read that failed this way is sent once more and the person stays on the page; only a session
// that cannot be renewed opens the sign-in page.
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  type Query,
} from '@tanstack/react-query';
import { Suspense, useState, type ReactNode } from 'react';
import { hasErrorCode } from '../../../lib/api/client.ts';
import { NavigationHistory } from '../../../lib/ui/navigation-history.tsx';
import { ToastViewport } from '../../../lib/ui/toast.tsx';
import { meQueryKey, SIGN_IN_PATH } from './account-queries.ts';

type AnyQuery = Query<unknown, unknown, unknown, readonly unknown[]>;

/** A read is sent again after a renewal at most once in this time. */
const RENEWED_READ_PAUSE_MS = 60_000;

/** Asks the signed-in session for a fresh token; true when the session is alive. */
async function renewSession(): Promise<boolean> {
  const session = window.Clerk?.session;
  return Boolean(session && (await session.getToken({ skipCache: true })));
}

function isProfileQuery(queryKey: readonly unknown[]) {
  return queryKey.length === meQueryKey.length && queryKey[0] === meQueryKey[0];
}

function createQueryClient() {
  const renewedReads = new WeakMap<AnyQuery, number>();
  let renewal: Promise<boolean> | null = null;

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({
      onError: (error, query) => onAccessError(error, query),
    }),
    mutationCache: new MutationCache({ onError: (error) => onAccessError(error, null) }),
  });

  /** One renewal for every request that failed at the same moment. */
  function renewOnce() {
    renewal ??= renewSession()
      .catch(() => false)
      .finally(() => {
        renewal = null;
      });
    return renewal;
  }

  function mayReadAgain(query: AnyQuery) {
    const last = renewedReads.get(query);
    return last === undefined || Date.now() - last > RENEWED_READ_PAUSE_MS;
  }

  /**
   * A refused read is sent again once the session is renewed; a refused change stays as it
   * failed, and the person can make it again. Without a session, the sign-in page opens.
   */
  async function onRefused(query: AnyQuery | null) {
    const readAgain = query !== null && mayReadAgain(query);
    if (await renewOnce()) {
      if (readAgain) {
        renewedReads.set(query, Date.now());
        void queryClient.refetchQueries({ queryKey: query.queryKey, exact: true });
        return;
      }
      if (query === null) {
        return;
      }
    }
    window.location.assign(SIGN_IN_PATH);
  }

  function onAccessError(error: unknown, query: AnyQuery | null) {
    if (hasErrorCode(error, 'UNAUTHENTICATED')) {
      void onRefused(query);
    } else if (
      !(query && isProfileQuery(query.queryKey)) &&
      hasErrorCode(error, 'NOT_A_MEMBER', 'TERMS_REQUIRED')
    ) {
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
