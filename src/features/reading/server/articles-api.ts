// The article endpoints (.docs/design/interfaces.md, 文章): the list, the ordered IDs of a query,
// one article, and recording a visit. The member has been checked by the caller; the list and the
// IDs carry that member's own visit times. The visit is written in a transaction that holds the
// member's row first, so no visit lands after the member is revoked.
import { dataResult, listResult, type ApiResult } from '../../../lib/api/responses.ts';
import { lockActiveMember } from '../../../lib/db/active-member.ts';
import { getDatabase, inTransaction, type Executor } from '../../../lib/db/client.ts';
import { articleIds, listArticles } from './article-list.ts';
import { readArticle, recordVisit } from './article-reading.ts';
import { articleIdsRequest, articleListRequest, articlePathId } from './article-request.ts';

/** `GET /api/articles`: one batch with the cursor of the next and the total count. */
export async function articleListResult(
  ownerId: string,
  params: URLSearchParams,
  executor: Executor = getDatabase(),
): Promise<ApiResult> {
  const { query, cursor } = articleListRequest(params);
  const batch = await listArticles(executor, ownerId, query, cursor);
  return listResult(batch.items, { nextCursor: batch.nextCursor, totalCount: batch.totalCount });
}

/** `GET /api/articles/ids`: every matching article ID in the list's order. */
export async function articleIdsResult(
  ownerId: string,
  params: URLSearchParams,
  executor: Executor = getDatabase(),
): Promise<ApiResult> {
  return dataResult({ ids: await articleIds(executor, ownerId, articleIdsRequest(params)) });
}

/** `GET /api/articles/:id`: the article with its sentences and timings. */
export async function articleResult(
  id: string,
  executor: Executor = getDatabase(),
): Promise<ApiResult> {
  return dataResult(await readArticle(executor, articlePathId(id)));
}

/** `PUT /api/articles/:id/visit`: the member's visit time. */
export async function visitResult(ownerId: string, id: string): Promise<ApiResult> {
  const articleId = articlePathId(id);
  return inTransaction(async (tx) => {
    await lockActiveMember(tx, ownerId);
    return dataResult(await recordVisit(tx, ownerId, articleId));
  });
}
