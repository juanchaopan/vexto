import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { dismissToast } from '../../../lib/ui/toast.tsx';
import { AppProviders } from './app-providers.tsx';
import { AcceptTermsScreen } from './member-gate.tsx';
import { TermsDocument } from './terms-document.tsx';

// next/link reads process.env, which a browser does not have.
vi.hoisted(() => {
  (globalThis as { process?: unknown }).process ??= { env: {} };
});

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  signOut: vi.fn(async () => undefined),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ signOut: mocks.signOut }) }));

const fetchMock = vi.spyOn(window, 'fetch');

beforeEach(() => {
  fetchMock.mockReset();
  mocks.replace.mockReset();
  mocks.signOut.mockClear();
});

afterEach(() => {
  act(() => dismissToast());
  cleanup();
});

function answer(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

function errorBody(code: string, retryable: boolean) {
  return { error: { code, message: 'Failed.', retryable, requestId: 'req_1' } };
}

const acceptance = { data: { acceptedVersion: 1, acceptedAt: '2026-11-22T09:15:00.000Z' } };

describe('TermsDocument before the first acceptance', () => {
  it('shows the version, the use restrictions, the license link and the two buttons', () => {
    render(<TermsDocument mode="accept" onAgree={() => {}} agreeing={false} onLogOut={() => {}} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Terms of use');
    expect(screen.getByText('Version 1 · November 22, 2026')).toBeInTheDocument();
    expect(
      screen.getByText('Please read and accept these terms to use vexto.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(13);
    expect(
      screen.getByText('To defame, disparage or otherwise harass others;'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the full license' })).toHaveAttribute(
      'href',
      '/license',
    );
    expect(screen.getByRole('button', { name: 'Log out' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'I agree' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Close terms' })).toBeNull();
    expect(screen.queryByText(/^Accepted /)).toBeNull();
  });

  it('disables I agree while the answer is being saved', () => {
    render(<TermsDocument mode="accept" onAgree={() => {}} agreeing onLogOut={() => {}} />);

    expect(screen.getByRole('button', { name: 'I agree' })).toBeDisabled();
  });
});

describe('TermsDocument opened from the account menu', () => {
  it('is read-only, shows the acceptance date and closes with X', async () => {
    const onClose = vi.fn();
    const acceptedAt = new Date();
    const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      acceptedAt,
    );
    render(<TermsDocument mode="read-only" acceptedAt={acceptedAt} onClose={onClose} />);

    expect(screen.getByText(`Accepted ${day}.`)).toBeInTheDocument();
    expect(screen.getByText('You accepted these terms to use vexto.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I agree' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Close terms' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('AcceptTermsScreen', () => {
  function renderScreen() {
    render(
      <AppProviders>
        <AcceptTermsScreen />
      </AppProviders>,
    );
  }

  it('records the version on I agree and opens Articles', async () => {
    answer(200, acceptance);
    renderScreen();

    await userEvent.click(screen.getByRole('button', { name: 'I agree' }));

    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/terms/acceptance');
    expect(init).toMatchObject({ method: 'POST', body: '{"version":1}' });
  });

  it('keeps the page and offers Retry when the answer could not be saved', async () => {
    answer(500, errorBody('INTERNAL', true));
    answer(200, acceptance);
    renderScreen();

    await userEvent.click(screen.getByRole('button', { name: 'I agree' }));

    const notice = await screen.findByText("Couldn't save your answer.");
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Terms of use' })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ body: '{"version":1}' });
  });

  it('offers Retry when the request got no response', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderScreen();

    await userEvent.click(screen.getByRole('button', { name: 'I agree' }));

    await screen.findByText("Couldn't save your answer.");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says so without Retry when repeating cannot help', async () => {
    answer(422, errorBody('INVALID_INPUT', false));
    renderScreen();

    await userEvent.click(screen.getByRole('button', { name: 'I agree' }));

    await screen.findByText("Couldn't save your answer.");
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('reloads the page without a notice when the terms shown are no longer current', async () => {
    // The reload is stopped so that the test runner's page stays.
    const reloads: string[] = [];
    const stopReload = (event: NavigateEvent) => {
      reloads.push(event.navigationType);
      event.preventDefault();
    };
    window.navigation.addEventListener('navigate', stopReload);
    answer(409, errorBody('CONFLICT', false));
    renderScreen();

    try {
      await userEvent.click(screen.getByRole('button', { name: 'I agree' }));

      await vi.waitFor(() => expect(reloads).toEqual(['reload']));
      expect(screen.queryByText("Couldn't save your answer.")).toBeNull();
      expect(mocks.replace).not.toHaveBeenCalled();
    } finally {
      window.navigation.removeEventListener('navigate', stopReload);
    }
  });

  it('logs out with Clerk and opens the sign-in page', async () => {
    renderScreen();

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: '/sign-in' });
  });
});
