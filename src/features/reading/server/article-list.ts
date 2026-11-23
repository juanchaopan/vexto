// The article list and the ordered IDs of a query (.docs/design/rules.md, 文章列表、搜索和播放).
// Only ready articles appear. The search is `plainto_tsquery('english', …)` against the generated
// body_fts column; a query of stop words only has no lexemes and matches nothing. Source and
// Category sort by the place of the display name in the configuration, so the keys are turned
// into those places in SQL. Last visited is the member's own visit; articles never visited come
// last in either direction. Equal values are ordered by ID in the same direction, which keeps the
// order total, and batches continue after a keyset cursor of the sort value and the ID.
import { and, count, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  decodeCursor,
  invalidCursor,
  microsecondTime,
  PAGE_SIZE,
  takePage,
  type CursorValue,
} from '../../../lib/api/cursor.ts';
import { sharedConfig } from '../../../lib/config/shared-config.ts';
import type { Executor } from '../../../lib/db/client.ts';
import { isoOrNull, microsecondText } from '../../../lib/db/columns.ts';
import { canonicalJson, sha256Hex } from '../../../lib/digest.ts';
import { articles, articleSentences, visits } from '../../articles/index.ts';
import { rankByName, type ArticleQuery, type ArticleSort } from '../domain/article-query.ts';

export type ArticleListItem = {
  id: string;
  title: string;
  excerpt: string;
  feedKey: string;
  categoryKey: string;
  collectedAt: string;
  lastVisitedAt: string | null;
};

export type ArticleListBatch = {
  items: ArticleListItem[];
  nextCursor: string | null;
  totalCount: number;
};

type SortSpec = {
  /** What the rows are ordered by. */
  value: SQL;
  /** The value as the cursor holds it. */
  key: SQL;
  /** The cursor's value as SQL to compare with, once it has been checked. */
  bound: (value: string | number) => SQL;
  /** The shape a cursor value of this sort must have. */
  cursorValue: z.ZodType<string | number>;
};

function timeSort(column: AnyColumn): SortSpec {
  return {
    value: sql`${column}`,
    key: microsecondText(column),
    bound: (value) => sql`${value}::timestamptz`,
    cursorValue: microsecondTime,
  };
}

/**
 * The places of the keys as a CASE expression; a key the configuration no longer has comes
 * last. The places are integers of the configuration, written into the SQL as numbers so the
 * expression has an integer type; the keys are parameters.
 */
function rankSort(column: AnyColumn, ranks: Map<string, number>): SortSpec {
  const cases = [...ranks].map(([key, rank]) => sql`when ${key} then ${sql.raw(String(rank))}`);
  const otherwise = sql.raw(String(ranks.size));
  const rank = sql`(case ${column} ${sql.join(cases, sql` `)} else ${otherwise} end)`;
  return {
    value: rank,
    key: rank,
    bound: (value) => sql`${value}::integer`,
    cursorValue: z.number().int().min(0),
  };
}

const lowerTitle = sql`lower(${articles.title})`;

const sorts: Record<ArticleSort, SortSpec> = {
  collected: timeSort(articles.collectedAt),
  visited: timeSort(visits.lastOpenedAt),
  article: {
    value: lowerTitle,
    key: lowerTitle,
    bound: (value) => sql`${value}::text`,
    cursorValue: z.string(),
  },
  source: rankSort(articles.feedKey, rankByName(sharedConfig.feeds)),
  category: rankSort(articles.categoryKey, rankByName(sharedConfig.categories)),
};

function filtersOf(query: ArticleQuery): SQL[] {
  const filters: SQL[] = [sql`${articles.state} = 'ready'`];
  if (query.feeds.length > 0) {
    filters.push(inArray(articles.feedKey, query.feeds));
  }
  if (query.categories.length > 0) {
    filters.push(inArray(articles.categoryKey, query.categories));
  }
  if (query.q !== '') {
    filters.push(sql`${articles.bodyFts} @@ plainto_tsquery('english', ${query.q})`);
  }
  return filters;
}

function orderOf(query: ArticleQuery): SQL[] {
  const direction = query.direction === 'asc' ? sql`asc` : sql`desc`;
  const order = [sql`${sorts[query.sort].value} ${direction}`, sql`${articles.id} ${direction}`];
  return query.sort === 'visited' ? [sql`(${visits.lastOpenedAt} is null) asc`, ...order] : order;
}

/** The cursor's scope: the sort, the direction and a digest of the search and the filters. */
function cursorScope(query: ArticleQuery): string {
  const filters = sha256Hex(
    canonicalJson({ q: query.q, feeds: query.feeds, categories: query.categories }),
  );
  return `articles:${query.sort}:${query.direction}:${filters.slice(0, 16)}`;
}

const cursorId = z.uuid();

/** Rows after the cursor's sort value and ID, in the query's order. */
function afterCursor(query: ArticleQuery, cursor: string): SQL {
  const [rawValue, rawId] = decodeCursor(cursorScope(query), cursor, 2);
  const id = cursorId.safeParse(rawId);
  if (!id.success) {
    invalidCursor();
  }
  const visitSort = query.sort === 'visited';
  const beyond = query.direction === 'asc' ? sql`>` : sql`<`;
  if (rawValue === null) {
    // Only the visit sort has rows without a value; they come last, ordered by ID.
    return visitSort
      ? sql`(${visits.lastOpenedAt} is null and ${articles.id} ${beyond} ${id.data}::uuid)`
      : invalidCursor();
  }
  const sort = sorts[query.sort];
  const value = sort.cursorValue.safeParse(rawValue);
  if (!value.success) {
    invalidCursor();
  }
  const bound = sql`(${sort.bound(value.data)}, ${id.data}::uuid)`;
  const after = sql`(${sort.value}, ${articles.id}) ${beyond} ${bound}`;
  return visitSort
    ? sql`((${visits.lastOpenedAt} is not null and ${after}) or ${visits.lastOpenedAt} is null)`
    : after;
}

function memberVisit(ownerId: string) {
  return and(eq(visits.articleId, articles.id), eq(visits.ownerId, ownerId));
}

/** One batch of the list for the member, the cursor of the next batch and the total count. */
export async function listArticles(
  executor: Executor,
  ownerId: string,
  query: ArticleQuery,
  cursor?: string,
): Promise<ArticleListBatch> {
  const filters = filtersOf(query);
  const where = cursor === undefined ? filters : [...filters, afterCursor(query, cursor)];
  const [rows, [{ total }]] = await Promise.all([
    executor
      .select({
        id: articles.id,
        title: articles.title,
        excerpt: articleSentences.text,
        feedKey: articles.feedKey,
        categoryKey: articles.categoryKey,
        collectedAt: articles.collectedAt,
        lastVisitedAt: visits.lastOpenedAt,
        sortKey: sql<CursorValue>`${sorts[query.sort].key}`,
      })
      .from(articles)
      .leftJoin(visits, memberVisit(ownerId))
      .leftJoin(
        articleSentences,
        and(eq(articleSentences.articleId, articles.id), eq(articleSentences.sentenceIndex, 0)),
      )
      .where(and(...where))
      .orderBy(...orderOf(query))
      .limit(PAGE_SIZE + 1),
    executor
      .select({ total: count() })
      .from(articles)
      .where(and(...filters)),
  ]);
  const page = takePage(rows, cursorScope(query), (row) => [row.sortKey, row.id]);
  return {
    items: page.items.map((row) => ({
      id: row.id,
      title: row.title,
      excerpt: row.excerpt ?? '',
      feedKey: row.feedKey,
      categoryKey: row.categoryKey,
      collectedAt: isoOrNull(row.collectedAt) ?? '',
      lastVisitedAt: isoOrNull(row.lastVisitedAt),
    })),
    nextCursor: page.nextCursor,
    totalCount: total,
  };
}

/** Every article ID the query matches, in its order: the queue of a continuous play. */
export async function articleIds(
  executor: Executor,
  ownerId: string,
  query: ArticleQuery,
): Promise<string[]> {
  const rows = await executor
    .select({ id: articles.id })
    .from(articles)
    .leftJoin(visits, memberVisit(ownerId))
    .where(and(...filtersOf(query)))
    .orderBy(...orderOf(query));
  return rows.map((row) => row.id);
}
