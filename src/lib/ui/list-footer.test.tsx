import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ListFooter } from './list-footer.tsx';

afterEach(() => {
  cleanup();
});

describe('ListFooter', () => {
  it('loads the next batch by itself when Load more is near the bottom of the screen', async () => {
    const onLoadMore = vi.fn();

    render(<ListFooter state={{ kind: 'more' }} onLoadMore={onLoadMore} />);

    await vi.waitFor(() => expect(onLoadMore).toHaveBeenCalledWith(false));
  });

  it('waits while it is far below the screen, and while automatic loading is off', async () => {
    const onLoadMore = vi.fn();
    render(
      <div>
        <div style={{ height: '3000px' }} />
        <ListFooter state={{ kind: 'more' }} onLoadMore={onLoadMore} />
      </div>,
    );
    render(<ListFooter state={{ kind: 'more' }} onLoadMore={onLoadMore} autoLoad={false} />);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('loads the next batch when Load more is pressed', async () => {
    const onLoadMore = vi.fn();
    render(<ListFooter state={{ kind: 'more' }} onLoadMore={onLoadMore} autoLoad={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(onLoadMore).toHaveBeenCalledWith(true);
  });

  it('shows a disabled Loading… while a batch loads, then All loaded at the end', () => {
    const { rerender } = render(<ListFooter state={{ kind: 'loading' }} onLoadMore={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();

    rerender(<ListFooter state={{ kind: 'done' }} onLoadMore={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('All loaded');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the failure in place of Load more, with Retry when it can help', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <ListFooter
        state={{ kind: 'failed', message: "Couldn't load more words.", onRetry }}
        onLoadMore={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(
      <ListFooter
        state={{ kind: 'failed', message: "Couldn't load more words." }}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load more words.");
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
