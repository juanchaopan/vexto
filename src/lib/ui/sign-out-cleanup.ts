// What logging out clears in the browser besides the cached server data
// (.docs/design/rules.md, 成员和登录): a part of the interface that keeps personal data or audio
// of its own, such as the player, registers a cleanup here, and logging out runs every cleanup
// before it signs out. Device settings such as the playback speed are not cleared.

const cleanups = new Set<() => void>();

/** Registers a cleanup to run on log out; the returned function removes it again. */
export function onSignOut(cleanup: () => void): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

/** Runs every registered cleanup; one that fails does not stop the others. */
export function runSignOutCleanups(): void {
  for (const cleanup of [...cleanups]) {
    try {
      cleanup();
    } catch {
      // Logging out goes on: the page reloads at the sign-in page, which drops what is left.
    }
  }
}
