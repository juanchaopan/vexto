// The rule every read and write shares for access errors (.docs/design/screens.md, 错误的显示, and
// .docs/design/rules.md, 错误和断网), against a stand-in for the interface and for the account
// part's handling: a refused read is sent again once the session is renewed, a refused write
// never is; a session that cannot be renewed opens the sign-in page, and NOT_A_MEMBER or
// TERMS_REQUIRED show the page the access calls for.
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import {
  createAccessHandledClient,
  leavesPage,
  writeRequest,
  type AccessHandling,
} from './access-handling.ts';
import { apiRequest, dataBody, hasErrorCode } from './client.ts';

const fetchMock = vi.spyOn(globalThis, 'fetch');

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const refusal = (status: number, code: string) =>
  json(status, { error: { code, message: 'Refused.', retryable: false, requestId: 'req_1' } });
const unauthenticated = () => refusal(401, 'UNAUTHENTICATED');
const ok = () => json(200, { data: { ok: true } });

const schema = dataBody(z.object({ ok: z.boolean() }));

/** The answers to the requests in order; the last one answers every later request too. */
let answers: (() => Response)[];
let sent: string[];

let renewSession: Mock<AccessHandling['renewSession']>;
let openSignIn: Mock<AccessHandling['openSignIn']>;
let accessChanged: Mock<AccessHandling['accessChanged']>;
let queryClient: QueryClient;

beforeEach(() => {
  answers = [ok];
  sent = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    sent.push(`${init?.method ?? 'GET'} ${String(input)}`);
    return (answers.length > 1 ? answers.shift()! : answers[0])();
  });
  renewSession = vi.fn(async () => true);
  openSignIn = vi.fn();
  accessChanged = vi.fn();
  queryClient = createAccessHandledClient(
    { renewSession, openSignIn, accessChanged },
    { queries: { retry: false } },
  );
});

afterEach(() => {
  queryClient.clear();
});

/** Watches a read, as a screen does, until it is stopped. */
function watchRead() {
  const observer = new QueryObserver(queryClient, {
    queryKey: ['page'],
    queryFn: () => apiRequest('/api/page', schema),
  });
  const stop = observer.subscribe(() => undefined);
  return { observer, stop };
}

function write() {
  return writeRequest(queryClient, '/api/page', schema, { method: 'POST', body: { n: 1 } });
}

async function failedWrite() {
  const error = await write().then(
    () => null,
    (failure: unknown) => failure,
  );
  expect(error).not.toBeNull();
  return error;
}

describe('a refused read', () => {
  it('is sent again once the session is renewed, and the page stays', async () => {
    answers = [unauthenticated, ok];
    const { observer, stop } = watchRead();

    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual({ data: { ok: true } }),
    );
    expect(sent).toEqual(['GET /api/page', 'GET /api/page']);
    expect(renewSession).toHaveBeenCalledTimes(1);
    expect(openSignIn).not.toHaveBeenCalled();
    stop();
  });

  it('opens the sign-in page when it is refused again within a minute', async () => {
    answers = [unauthenticated];
    const { stop } = watchRead();

    await vi.waitFor(() => expect(openSignIn).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(2);
    stop();
  });

  it('opens the sign-in page when the session gives no token', async () => {
    renewSession.mockResolvedValue(false);
    answers = [unauthenticated];
    const { stop } = watchRead();

    await vi.waitFor(() => expect(openSignIn).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(1);
    stop();
  });

  it('opens the sign-in page when asking the session fails', async () => {
    renewSession.mockRejectedValue(new Error('Clerk is not loaded.'));
    answers = [unauthenticated];
    const { stop } = watchRead();

    await vi.waitFor(() => expect(openSignIn).toHaveBeenCalledTimes(1));
    stop();
  });

  it.each(['NOT_A_MEMBER', 'TERMS_REQUIRED'])(
    'answering %s shows the page the access calls for',
    async (code) => {
      answers = [() => refusal(403, code)];
      const { stop } = watchRead();

      await vi.waitFor(() => expect(accessChanged).toHaveBeenCalledTimes(1));
      expect(accessChanged.mock.calls[0][0]?.queryKey).toEqual(['page']);
      expect(renewSession).not.toHaveBeenCalled();
      stop();
    },
  );
});

describe('a refused write', () => {
  it('is not sent again once the session is renewed, and fails as it was refused', async () => {
    answers = [unauthenticated, ok];

    const error = await failedWrite();

    expect(hasErrorCode(error, 'UNAUTHENTICATED')).toBe(true);
    expect(leavesPage(error)).toBe(false);
    expect(sent).toEqual(['POST /api/page']);
    expect(renewSession).toHaveBeenCalledTimes(1);
    expect(openSignIn).not.toHaveBeenCalled();
  });

  it('opens the sign-in page and leaves the page when the session cannot be renewed', async () => {
    renewSession.mockResolvedValue(false);
    answers = [unauthenticated];

    const error = await failedWrite();

    expect(hasErrorCode(error, 'UNAUTHENTICATED')).toBe(true);
    expect(leavesPage(error)).toBe(true);
    expect(openSignIn).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it.each(['NOT_A_MEMBER', 'TERMS_REQUIRED'] as const)(
    'answering %s shows the page the access calls for and leaves the page',
    async (code) => {
      answers = [() => refusal(403, code)];

      const error = await failedWrite();

      expect(hasErrorCode(error, code)).toBe(true);
      expect(leavesPage(error)).toBe(true);
      expect(accessChanged).toHaveBeenCalledWith(null);
      expect(renewSession).not.toHaveBeenCalled();
    },
  );

  it('passes any other failure on as it is', async () => {
    answers = [() => refusal(500, 'INTERNAL')];

    const error = await failedWrite();

    expect(hasErrorCode(error, 'INTERNAL')).toBe(true);
    expect(leavesPage(error)).toBe(false);
    expect(renewSession).not.toHaveBeenCalled();
    expect(openSignIn).not.toHaveBeenCalled();
    expect(accessChanged).not.toHaveBeenCalled();
  });

  it('returns the success body of a write that is not refused', async () => {
    await expect(write()).resolves.toEqual({ data: { ok: true } });
  });

  it('passes every failure on as it is on a query client without access handling', async () => {
    renewSession.mockResolvedValue(false);
    answers = [unauthenticated];
    const plain = new QueryClient();

    const error = await writeRequest(plain, '/api/page', schema, { method: 'POST' }).then(
      () => null,
      (failure: unknown) => failure,
    );

    expect(hasErrorCode(error, 'UNAUTHENTICATED')).toBe(true);
    expect(leavesPage(error)).toBe(false);
    expect(renewSession).not.toHaveBeenCalled();
  });
});

describe('requests refused at the same moment', () => {
  it('share one renewal of the session', async () => {
    let release!: (alive: boolean) => void;
    renewSession.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    answers = [unauthenticated, unauthenticated, ok];

    const { observer, stop } = watchRead();
    const writing = failedWrite();
    await vi.waitFor(() => expect(renewSession).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    release(true);

    expect(leavesPage(await writing)).toBe(false);
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual({ data: { ok: true } }),
    );
    expect(renewSession).toHaveBeenCalledTimes(1);
    expect(openSignIn).not.toHaveBeenCalled();
    stop();
  });
});
