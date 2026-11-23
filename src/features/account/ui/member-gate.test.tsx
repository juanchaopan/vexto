// The access errors every request shares (.docs/design/screens.md, 错误的显示): inside the
// application's providers and the member gate, a request of any page that finds the session ended
// loads the sign-in page in full, and one that finds the person no longer a member or the terms
// not accepted reads the profile again, so the gate shows the no access page or the terms page.
// A read refused while the session is still alive, as when Clerk is renewing its token, is sent
// again after the session gives a fresh token.
import { useMutation, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';
import { apiRequest, dataBody } from '../../../lib/api/client.ts';
import { sharedConfig } from '../../../lib/config/shared-config.ts';
import { dismissToast } from '../../../lib/ui/toast.tsx';
import { AppProviders } from './app-providers.tsx';
import { MemberGate } from './member-gate.tsx';

// next/link reads process.env, which a browser does not have.
vi.hoisted(() => {
  (globalThis as { process?: unknown }).process ??= { env: {} };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ signOut: vi.fn(async () => undefined) }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'reader@example.com' } } }),
}));

/** Puts a Clerk instance with a session on the page, as Clerk does once it has loaded. */
function giveSession(getToken: () => Promise<string | null>) {
  Object.defineProperty(window, 'Clerk', {
    value: { session: { getToken } },
    configurable: true,
    writable: true,
  });
}

function takeSessionAway() {
  Reflect.deleteProperty(window, 'Clerk');
}

const fetchMock = vi.spyOn(window, 'fetch');

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function errorBody(code: string) {
  return { error: { code, message: 'Failed.', retryable: false, requestId: 'req_1' } };
}

function profile(acceptedVersion: number | null) {
  return json(200, {
    data: {
      email: 'reader@example.com',
      terms: {
        currentVersion: sharedConfig.terms.version,
        acceptedVersion,
        acceptedAt: acceptedVersion === null ? null : '2026-11-22T09:15:00.000Z',
      },
    },
  });
}

const member = () => profile(sharedConfig.terms.version);

/** The answers of the profile reads in order; the last one answers every later read too. */
let profileReads: (() => Response)[];
/** The answers of the page's reads in order; the last one answers every later read too. */
let pageAnswers: (() => Response)[];
const sentPaths: string[] = [];

/** The full-page loads the page starts, stopped so that the test runner's page stays. */
const loads: string[] = [];

function stopLoad(event: NavigateEvent) {
  if (!event.destination.sameDocument) {
    loads.push(event.destination.url);
    event.preventDefault();
  }
}

function next(answers: (() => Response)[]) {
  return (answers.length > 1 ? answers.shift()! : answers[0])();
}

beforeEach(() => {
  takeSessionAway();
  sentPaths.length = 0;
  loads.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const path = new URL(String(input), window.location.href).pathname;
    sentPaths.push(path);
    if (path === '/api/me') {
      return next(profileReads);
    }
    return path === '/api/page' ? next(pageAnswers) : json(500, errorBody('INTERNAL'));
  });
  window.navigation.addEventListener('navigate', stopLoad);
});

afterEach(() => {
  window.navigation.removeEventListener('navigate', stopLoad);
  takeSessionAway();
  act(() => dismissToast());
  cleanup();
});

const pageSchema = dataBody(z.object({ ok: z.boolean() }));

/** A page that reads its data as soon as it shows. */
function ReadingPage() {
  const page = useQuery({
    queryKey: ['page'],
    queryFn: async () => (await apiRequest('/api/page', pageSchema)).data,
  });
  if (page.isError) {
    return <p>Page failed</p>;
  }
  return <p>{page.data ? 'Page content' : 'Page loading'}</p>;
}

/** A page that changes its data when its button is pressed. */
function WritingPage() {
  const change = useMutation({
    mutationFn: () => apiRequest('/api/page', pageSchema, { method: 'POST' }),
  });
  return (
    <button type="button" onClick={() => change.mutate()}>
      Change page
    </button>
  );
}

function renderGate(page: ReactNode) {
  render(
    <AppProviders>
      <MemberGate>{page}</MemberGate>
    </AppProviders>,
  );
}

const profileReadCount = () => sentPaths.filter((path) => path === '/api/me').length;
const pageReadCount = () => sentPaths.filter((path) => path === '/api/page').length;
const signInPage = () => new URL('/sign-in', window.location.href).href;
const refused = () => json(401, errorBody('UNAUTHENTICATED'));

describe('a request that answers with an access error', () => {
  it('loads the sign-in page in full when the session ended', async () => {
    profileReads = [member];
    pageAnswers = [refused];

    renderGate(<ReadingPage />);

    await vi.waitFor(() => expect(loads).toEqual([signInPage()]));
    expect(profileReadCount()).toBe(1);
  });

  it('reads again, staying on the page, when the session gives a fresh token', async () => {
    const getToken = vi.fn(async () => 'fresh-token');
    giveSession(getToken);
    profileReads = [member];
    pageAnswers = [refused, () => json(200, { data: { ok: true } })];

    renderGate(<ReadingPage />);

    expect(await screen.findByText('Page content')).toBeVisible();
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(pageReadCount()).toBe(2);
    expect(loads).toEqual([]);
  });

  it('loads the sign-in page when the read is refused again after the renewal', async () => {
    giveSession(async () => 'fresh-token');
    profileReads = [member];
    pageAnswers = [refused];

    renderGate(<ReadingPage />);

    await vi.waitFor(() => expect(loads).toEqual([signInPage()]));
    expect(pageReadCount()).toBe(2);
  });

  it('loads the sign-in page when the session gives no token', async () => {
    giveSession(async () => null);
    profileReads = [member];
    pageAnswers = [refused];

    renderGate(<ReadingPage />);

    await vi.waitFor(() => expect(loads).toEqual([signInPage()]));
    expect(pageReadCount()).toBe(1);
  });

  it('reads the profile again and shows No access when the person is no longer a member', async () => {
    profileReads = [member, () => json(403, errorBody('NOT_A_MEMBER'))];
    pageAnswers = [() => json(403, errorBody('NOT_A_MEMBER'))];

    renderGate(<ReadingPage />);

    expect(await screen.findByRole('heading', { name: 'No access' })).toBeVisible();
    expect(
      screen.getByText("reader@example.com isn't on the vexto invitation list."),
    ).toBeVisible();
    expect(screen.queryByText(/^Page /)).toBeNull();
    expect(profileReadCount()).toBe(2);
    expect(loads).toEqual([]);
  });

  it('reads the profile again and shows the terms page when the terms are not accepted', async () => {
    profileReads = [member, () => profile(null)];
    pageAnswers = [() => json(403, errorBody('TERMS_REQUIRED'))];
    renderGate(<WritingPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change page' }));

    expect(await screen.findByRole('heading', { name: 'Terms of use' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'I agree' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Change page' })).toBeNull();
    expect(profileReadCount()).toBe(2);
    expect(loads).toEqual([]);
  });
});
