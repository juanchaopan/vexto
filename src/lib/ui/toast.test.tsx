import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, showToast, TOAST_DURATION_MS, ToastViewport } from './toast.tsx';

const navigation = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

beforeEach(() => {
  vi.useFakeTimers();
  navigation.pathname = '/';
});

afterEach(() => {
  act(() => dismissToast());
  cleanup();
  vi.useRealTimers();
});

function notice() {
  return screen.getByRole('status');
}

describe('ToastViewport', () => {
  it('reads a plain notice out and removes it after about 3.5 seconds', () => {
    render(<ToastViewport />);

    act(() => showToast('Saved to Vocabulary.'));
    expect(notice()).toHaveTextContent('Saved to Vocabulary.');
    expect(notice()).toHaveAttribute('aria-live', 'polite');

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 100));
    expect(notice()).toHaveTextContent('Saved to Vocabulary.');
    act(() => vi.advanceTimersByTime(100));
    expect(notice()).toBeEmptyDOMElement();
  });

  it('keeps a notice with Retry until Retry is pressed, then runs it', () => {
    const retry = vi.fn();
    render(<ToastViewport />);

    act(() => showToast("Couldn't save your answer.", { retry }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(notice()).toContainElement(screen.getByText("Couldn't save your answer."));

    act(() => screen.getByRole('button', { name: 'Retry' }).click());
    expect(retry).toHaveBeenCalledOnce();
    expect(notice()).toBeEmptyDOMElement();
  });

  it('replaces the notice on screen with a new one', () => {
    render(<ToastViewport />);

    act(() => showToast("Couldn't save your answer.", { retry: () => {} }));
    act(() => showToast('Saved to Vocabulary.'));

    expect(notice()).toHaveTextContent('Saved to Vocabulary.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('drops a notice with Retry when the page changes, but not a plain one', () => {
    const { rerender } = render(<ToastViewport />);
    act(() => showToast("Couldn't save your answer.", { retry: () => {} }));

    navigation.pathname = '/vocabulary';
    rerender(<ToastViewport />);
    expect(notice()).toBeEmptyDOMElement();

    act(() => showToast('This article is no longer available.'));
    navigation.pathname = '/';
    rerender(<ToastViewport />);
    expect(notice()).toHaveTextContent('This article is no longer available.');
  });

  it('draws the notice inside an open modal dialog, where Retry still works', async () => {
    const retry = vi.fn();
    render(
      <>
        <dialog aria-label="Replace saved word?" />
        <ToastViewport />
      </>,
    );
    const dialog = screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement;
    act(() => dialog.showModal());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => showToast("Couldn't replace the word.", { retry }));

    expect(dialog).toContainElement(notice());
    act(() => screen.getByRole('button', { name: 'Retry' }).click());
    expect(retry).toHaveBeenCalledOnce();
    act(() => dialog.close());
  });
});
