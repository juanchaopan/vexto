// What every request of the browser does when the interface answers with an access error
// (.docs/design/screens.md, 错误的显示, and .docs/design/rules.md, 错误和断网): UNAUTHENTICATED
// opens the sign-in page, NOT_A_MEMBER and TERMS_REQUIRED show the no access page or the terms
// page. The account part of the interface says how each of these is done; this module decides
// when, the same way for every read and every write.
//
// A request can answer UNAUTHENTICATED while the session is still alive: Clerk renews the
// one-minute session token in the browser, and a request sent while it does so carries a token
// the server takes as outdated. So the session is first asked for a fresh token, once for every
// request refused at the same moment, and the sign-in page opens only when there is none.
//   - A read is the query client's: when the session is renewed, the refused read is sent again,
//     at most once a minute for the same read; refused again within the minute, the sign-in page
//     opens.
//   - A write goes through writeRequest and is never sent again: with the session renewed it
//     fails as it was refused, and the operation shows its failure without Retry, so the person
//     can make it again. When the page changes instead, leavesPage tells the operation to show
//     nothing of its own.
import { QueryCache, QueryClient, type DefaultOptions, type Query } from '@tanstack/react-query';
import type { z } from 'zod';
import { apiRequest, hasErrorCode, type ApiRequestInit } from './client.ts';

export type AnyQuery = Query<unknown, unknown, unknown, readonly unknown[]>;

export type AccessHandling = {
  /** Asks the signed-in session for a fresh token; true when the session is still alive. */
  renewSession(): Promise<boolean>;
  /** Opens the sign-in page. */
  openSignIn(): void;
  /**
   * Shows the page the person's access now calls for, after a request answered NOT_A_MEMBER or
   * TERMS_REQUIRED; `query` is the refused read, or null for a write.
   */
  accessChanged(query: AnyQuery | null): void;
};

/** A read is sent again after a renewal at most once in this time. */
const RENEWED_READ_PAUSE_MS = 60_000;

/** How each query client's access handling answers a refused write: true when the page changes. */
const writeAnswers = new WeakMap<QueryClient, (error: unknown) => Promise<boolean>>();

/** The errors of writes the page changes for. */
const pageChanges = new WeakSet<object>();

/** A query client whose reads and writes answer access errors with the given handling. */
export function createAccessHandledClient(
  handling: AccessHandling,
  defaultOptions?: DefaultOptions,
): QueryClient {
  const renewedReads = new WeakMap<AnyQuery, number>();
  let renewal: Promise<boolean> | null = null;

  const queryClient: QueryClient = new QueryClient({
    defaultOptions,
    queryCache: new QueryCache({ onError: (error, query) => readFailed(error, query) }),
  });

  /** One renewal for every request refused at the same moment. */
  function renewOnce() {
    renewal ??= handling
      .renewSession()
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

  async function readRefused(query: AnyQuery) {
    const readAgain = mayReadAgain(query);
    if ((await renewOnce()) && readAgain) {
      renewedReads.set(query, Date.now());
      void queryClient.refetchQueries({ queryKey: query.queryKey, exact: true });
      return;
    }
    handling.openSignIn();
  }

  function readFailed(error: unknown, query: AnyQuery) {
    if (hasErrorCode(error, 'UNAUTHENTICATED')) {
      void readRefused(query);
    } else if (hasErrorCode(error, 'NOT_A_MEMBER', 'TERMS_REQUIRED')) {
      handling.accessChanged(query);
    }
  }

  async function writeFailed(error: unknown): Promise<boolean> {
    if (hasErrorCode(error, 'UNAUTHENTICATED')) {
      if (await renewOnce()) {
        return false;
      }
      handling.openSignIn();
      return true;
    }
    if (hasErrorCode(error, 'NOT_A_MEMBER', 'TERMS_REQUIRED')) {
      handling.accessChanged(null);
      return true;
    }
    return false;
  }

  writeAnswers.set(queryClient, writeFailed);
  return queryClient;
}

/**
 * Sends a write to the interface, like apiRequest, and answers an access error by the rule of the
 * query client's access handling before the error reaches the caller. A query client without
 * access handling, as in tests of a single screen, passes every error on as it is.
 */
export async function writeRequest<T>(
  queryClient: QueryClient,
  path: string,
  schema: z.ZodType<T>,
  init: ApiRequestInit,
): Promise<T> {
  try {
    return await apiRequest(path, schema, init);
  } catch (error) {
    const answer = writeAnswers.get(queryClient);
    if (answer && (await answer(error)) && typeof error === 'object' && error !== null) {
      pageChanges.add(error);
    }
    throw error;
  }
}

/**
 * Whether the page changes for the failed write: to the sign-in page, the no access page or the
 * terms page. The operation then shows nothing of its own for the failure.
 */
export function leavesPage(error: unknown): boolean {
  return typeof error === 'object' && error !== null && pageChanges.has(error);
}
