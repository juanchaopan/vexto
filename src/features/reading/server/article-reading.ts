// One article as the reader shows it, and the member's visit to it (.docs/design/interfaces.md,
// 一篇文章 and 记录访问). Articles are shared by every member; only ready articles whose audio is
// ready can be read. A visit is one row per member and article, written with the database's
// time, and it never moves back: two visits arriving out of order keep the later time.
import { and, asc, eq, sql } from 'drizzle-orm';
import { ApiError } from '../../../lib/api/errors.ts';
import type { Executor } from '../../../lib/db/client.ts';
import { articles, articleSentences } from '../../articles/index.ts';
import { audioAssets } from '../../audio/index.ts';

export type ReaderSentence = {
  index: number;
  paragraphIndex: number;
  text: string;
  startMs: number;
  endMs: number;
};

export type ReaderArticle = {
  id: string;
  title: string;
  feedKey: string;
  categoryKey: string;
  author: string | null;
  sourceUrl: string;
  collectedAt: string;
  durationMs: number;
  sentences: ReaderSentence[];
};

const notFound = () => new ApiError('NOT_FOUND', 'The article was not found.');

/** The ready article with its sentences and timings; NOT_FOUND when there is none. */
export async function readArticle(executor: Executor, articleId: string): Promise<ReaderArticle> {
  const [article] = await executor
    .select({
      id: articles.id,
      title: articles.title,
      feedKey: articles.feedKey,
      categoryKey: articles.categoryKey,
      author: articles.author,
      sourceUrl: articles.sourceUrl,
      collectedAt: articles.collectedAt,
      durationMs: audioAssets.durationMs,
    })
    .from(articles)
    .innerJoin(audioAssets, eq(audioAssets.id, articles.audioAssetId))
    .where(
      and(eq(articles.id, articleId), eq(articles.state, 'ready'), eq(audioAssets.state, 'ready')),
    );
  if (!article?.collectedAt || !article.durationMs) {
    throw notFound();
  }
  const sentences = await executor
    .select({
      index: articleSentences.sentenceIndex,
      paragraphIndex: articleSentences.paragraphIndex,
      text: articleSentences.text,
      startMs: articleSentences.startMs,
      endMs: articleSentences.endMs,
    })
    .from(articleSentences)
    .where(eq(articleSentences.articleId, articleId))
    .orderBy(asc(articleSentences.sentenceIndex));
  return {
    ...article,
    collectedAt: article.collectedAt.toISOString(),
    durationMs: article.durationMs,
    sentences: sentences.map((sentence) => ({
      ...sentence,
      startMs: sentence.startMs ?? 0,
      endMs: sentence.endMs ?? 0,
    })),
  };
}

/**
 * Records that the member opened the article now and returns the visit time; NOT_FOUND, with no
 * visit written, when the article is not ready.
 */
export async function recordVisit(
  executor: Executor,
  ownerId: string,
  articleId: string,
): Promise<{ lastVisitedAt: string }> {
  const rows = await executor.execute<{ last_opened_at: Date | string }>(sql`
    insert into visits (owner_id, article_id, last_opened_at)
    select ${ownerId}::uuid, ${articles.id}, now()
    from ${articles}
    where ${articles.id} = ${articleId}::uuid and ${articles.state} = 'ready'
    on conflict (owner_id, article_id)
    do update set last_opened_at = greatest(visits.last_opened_at, excluded.last_opened_at)
    returning last_opened_at`);
  const [row] = rows;
  if (!row) {
    throw notFound();
  }
  return { lastVisitedAt: new Date(row.last_opened_at).toISOString() };
}
