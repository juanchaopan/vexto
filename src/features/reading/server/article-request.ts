// The query string of `GET /api/articles` and `GET /api/articles/ids`
// (.docs/design/interfaces.md, 文章列表): `q`, repeatable `feed` and `category`, `sort`,
// `direction`, and on the list a `cursor`. A name the endpoint does not take, a value given twice
// where one is allowed, or a key that is not in the configuration is invalid input.
import { z } from 'zod';
import { ApiError } from '../../../lib/api/errors.ts';
import { parseInput } from '../../../lib/api/route.ts';
import { sharedConfig } from '../../../lib/config/shared-config.ts';
import {
  ARTICLE_SEARCH_MAX_LENGTH,
  ARTICLE_SORTS,
  DEFAULT_ARTICLE_QUERY,
  effectiveChoices,
  SORT_DIRECTIONS,
  type ArticleQuery,
} from '../domain/article-query.ts';

const feedKeys = sharedConfig.feeds.map((feed) => feed.key);
const categoryKeys = sharedConfig.categories.map((category) => category.key);

const repeatable = new Set(['feed', 'category']);

const keys = (allowed: readonly string[]) =>
  z.array(z.string().refine((key) => allowed.includes(key), 'is not a known key'));

// PostgreSQL text cannot hold a NUL character, so a search with one is refused here.
const searchText = z
  .string()
  .max(ARTICLE_SEARCH_MAX_LENGTH)
  .refine((text) => !text.includes('\u0000'), 'must not contain a NUL character');

const queryFields = {
  q: searchText.optional(),
  feed: keys(feedKeys),
  category: keys(categoryKeys),
  sort: z.enum(ARTICLE_SORTS).optional(),
  direction: z.enum(SORT_DIRECTIONS).optional(),
};

const listParams = z.strictObject({ ...queryFields, cursor: z.string().max(2000).optional() });
const idParams = z.strictObject(queryFields);

/** The parameters as an object: repeatable names as arrays, the others as single strings. */
function paramObject(params: URLSearchParams): Record<string, unknown> {
  const object: Record<string, unknown> = { feed: [], category: [] };
  for (const name of new Set(params.keys())) {
    const values = params.getAll(name);
    if (repeatable.has(name)) {
      object[name] = values;
    } else if (values.length > 1) {
      throw new ApiError('INVALID_INPUT', `The parameter ${name} is given more than once.`);
    } else {
      object[name] = values[0];
    }
  }
  return object;
}

function toQuery(fields: z.infer<typeof idParams>): ArticleQuery {
  return {
    q: fields.q?.trim() ?? DEFAULT_ARTICLE_QUERY.q,
    feeds: effectiveChoices(fields.feed, feedKeys),
    categories: effectiveChoices(fields.category, categoryKeys),
    sort: fields.sort ?? DEFAULT_ARTICLE_QUERY.sort,
    direction: fields.direction ?? DEFAULT_ARTICLE_QUERY.direction,
  };
}

/** The query and cursor of an article list request. */
export function articleListRequest(params: URLSearchParams): {
  query: ArticleQuery;
  cursor: string | undefined;
} {
  const fields = parseInput(listParams, paramObject(params));
  return { query: toQuery(fields), cursor: fields.cursor };
}

/** The query of an ID list request, which has no cursor. */
export function articleIdsRequest(params: URLSearchParams): ArticleQuery {
  return toQuery(parseInput(idParams, paramObject(params)));
}

const uuid = z.uuid();

/** The article ID of a path; one that is not a UUID names no article. */
export function articlePathId(id: string): string {
  if (!uuid.safeParse(id).success) {
    throw new ApiError('NOT_FOUND', 'The article was not found.');
  }
  return id;
}
