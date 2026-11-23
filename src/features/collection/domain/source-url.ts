// Original addresses of feed entries (.docs/design/rules.md, 整理一篇文章). An entry's link is
// made absolute against the feed's address. For telling entries apart, the address is normalized:
// lower-case host, no fragment, no tracking parameters such as utm_*, no trailing slash. Its hash
// is the key of seen_items, so the same article reached through two feeds or two campaign links
// is collected once.

/** Query parameters that only track where a visitor came from. */
const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  '_hsenc',
  '_hsmi',
]);

function isTracking(name: string) {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMETERS.has(lower);
}

function parseWebUrl(link: string, base?: string): URL | null {
  if (!URL.canParse(link.trim(), base)) {
    return null;
  }
  const url = new URL(link.trim(), base);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
}

/** The entry's link as an absolute http(s) address, or null when it is not one. */
export function absoluteLink(link: string, base: string): string | null {
  return parseWebUrl(link, base)?.href ?? null;
}

/** The normalized form of an absolute http(s) address, or null when it is not one. */
export function normalizeSourceUrl(link: string): string | null {
  const url = parseWebUrl(link);
  if (!url) {
    return null;
  }
  const kept = [...url.searchParams].filter(([name]) => !isTracking(name));
  const query = new URLSearchParams(kept).toString();
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ''}`;
}
