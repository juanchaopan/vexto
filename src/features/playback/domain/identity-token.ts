// When a Google identity token is still good to send. The speech service accepts a token until
// it expires; one that has little time left is fetched again, so a request is never sent with a
// token that runs out on the way.

/** A token with less than this left is fetched again. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

function base64UrlJson(part: string): unknown {
  const base64 = part.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded)) as unknown;
}

/** The expiry of a JWT from its `exp` claim, or null when it has none it can read. */
export function tokenExpiry(token: string): Date | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const claims = base64UrlJson(parts[1]) as { exp?: unknown };
    return typeof claims.exp === 'number' ? new Date(claims.exp * 1000) : null;
  } catch {
    return null;
  }
}

/** Whether a token that expires then may still be sent now. */
export function isTokenFresh(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() - now.getTime() > TOKEN_REFRESH_MARGIN_MS;
}
