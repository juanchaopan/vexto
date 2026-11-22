/**
 * The kinds of external call that are recorded: a lookup, the same-meaning check, an example
 * refresh, the Translate options, and the speech of an article, a word or an example.
 */
export const USAGE_KINDS = [
  'lookup',
  'meaning_match',
  'example',
  'translation',
  'article_tts',
  'word_tts',
  'example_tts',
] as const;

export type UsageKind = (typeof USAGE_KINDS)[number];

/**
 * A record is `pending` from just before the call until its result is known; `unknown` is a
 * call whose outcome could not be learned, such as one that timed out.
 */
export const USAGE_STATUSES = ['pending', 'succeeded', 'failed', 'unknown'] as const;

export type UsageStatus = (typeof USAGE_STATUSES)[number];

export type FinishedUsageStatus = Exclude<UsageStatus, 'pending'>;
