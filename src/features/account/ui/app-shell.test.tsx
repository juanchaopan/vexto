// The frame of the application's screens (.docs/design/screens.md, 顶栏): the Vocabulary button
// carries the due and new reviews of Spell and Translate added together, shows no dots for 0, and
// shows the counts it had when they cannot be read again.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshReviewCounts } from '../../../lib/ui/review-counts.ts';
import { AppShell } from './app-shell.tsx';

// next/link reads process.env, which a browser does not have.
vi.hoisted(() => {
  (globalThis as { process?: unknown }).process ??= { env: {} };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/review/spell',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: { fullName: 'Alex Chen' } }),
}));

const fetchMock = vi.spyOn(window, 'fetch');

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
});

const countsBody = (spell: [number, number], translate: [number, number]) =>
  new Response(
    JSON.stringify({
      data: {
        spell: { due: spell[0], new: spell[1] },
        translate: { due: translate[0], new: translate[1] },
      },
    }),
    { status: 200 },
  );

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <p>Screen</p>
      </AppShell>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('the frame', () => {
  it('adds the counts of Spell and Translate on the Vocabulary button', async () => {
    fetchMock.mockResolvedValueOnce(countsBody([3, 2], [2, 2]));

    renderShell();

    const vocabulary = await screen.findByRole('link', {
      name: 'Vocabulary, 5 due reviews, 4 new reviews',
    });
    expect(vocabulary).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('5')).toBeVisible();
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText('Screen')).toBeVisible();
  });

  it('draws no dot for a count of 0 and keeps the counts when reading them again fails', async () => {
    fetchMock.mockResolvedValueOnce(countsBody([0, 1], [0, 0]));
    const queryClient = renderShell();
    await screen.findByRole('link', { name: 'Vocabulary, 0 due reviews, 1 new reviews' });
    expect(screen.queryByText('0')).toBeNull();

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => refreshReviewCounts(queryClient));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      screen.getByRole('link', { name: 'Vocabulary, 0 due reviews, 1 new reviews' }),
    ).toBeVisible();
  });
});
