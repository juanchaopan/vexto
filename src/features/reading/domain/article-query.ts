// What the article list shows (.docs/design/rules.md, 文章列表、搜索和播放): a full-text search of
// the body, Source and Category filters, and one sort in one direction. The same query names the
// batches of the list and the ordered IDs of a continuous play.

export const ARTICLE_SORTS = ['collected', 'visited', 'article', 'source', 'category'] as const;

export type ArticleSort = (typeof ARTICLE_SORTS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** The search box takes no more characters than this. */
export const ARTICLE_SEARCH_MAX_LENGTH = 200;

export type ArticleQuery = {
  /** English full-text search of the body; empty for no search. */
  q: string;
  /** Feed keys, any of which matches; empty for every feed. */
  feeds: string[];
  /** Category keys, any of which matches; empty for every category. */
  categories: string[];
  sort: ArticleSort;
  direction: SortDirection;
};

/** Collected, newest first, with no search and no filter. */
export const DEFAULT_ARTICLE_QUERY: ArticleQuery = {
  q: '',
  feeds: [],
  categories: [],
  sort: 'collected',
  direction: 'desc',
};

/**
 * The keys a filter keeps, in the order of the options. Choosing every option is the same as
 * choosing none, so it comes out empty, and a key that is not an option is dropped.
 */
export function effectiveChoices(
  selected: readonly string[],
  options: readonly string[],
): string[] {
  const kept = options.filter((option) => selected.includes(option));
  return kept.length === options.length ? [] : kept;
}

/** True when a search or a filter narrows the list, so an empty list means nothing matched. */
export function isNarrowed(query: ArticleQuery): boolean {
  return query.q !== '' || query.feeds.length > 0 || query.categories.length > 0;
}

export type Named = { key: string; name: string };

/**
 * The place of each key when the items are ordered by display name, A to Z without regard to
 * case; Source and Category sort by these places, so the order follows the names a person reads.
 */
export function rankByName(items: readonly Named[]): Map<string, number> {
  const ordered = [...items].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key),
  );
  return new Map(ordered.map((item, index) => [item.key, index]));
}
