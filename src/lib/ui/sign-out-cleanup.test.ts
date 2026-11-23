import { describe, expect, it, vi } from 'vitest';
import { onSignOut, runSignOutCleanups } from './sign-out-cleanup.ts';

describe('onSignOut and runSignOutCleanups', () => {
  it('runs every registered cleanup, even after one fails', () => {
    const first = vi.fn(() => {
      throw new Error('player gone');
    });
    const second = vi.fn();
    const removeFirst = onSignOut(first);
    const removeSecond = onSignOut(second);

    runSignOutCleanups();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    removeFirst();
    removeSecond();
  });

  it('no longer runs a cleanup that was removed', () => {
    const cleanup = vi.fn();
    const remove = onSignOut(cleanup);
    remove();

    runSignOutCleanups();

    expect(cleanup).not.toHaveBeenCalled();
  });
});
