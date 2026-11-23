// Turning one feed entry into an article (.docs/design/rules.md, 选条目 and 整理一篇文章). The
// body comes from the entry itself or from its original page, as the feed is configured; it is
// cleaned, split into sentences and checked against the word limits and the bodies already
// collected. The article, its sentences and the entry's seen row are written together, and the
// article is synthesized right after. An entry that is skipped still gets its seen row, so it is
// never fetched again; one whose page failed only for now gets none and may be tried again.
import { sha256Hex } from '../../../lib/digest.ts';
import { log } from '../../../lib/log.ts';
import { articleSentences, articles } from '../../articles/index.ts';
import {
  buildArticleBody,
  normalizeParagraph,
  withinWordLimits,
  withoutTitleParagraph,
  type ArticleBody,
} from '../domain/article-body.ts';
import { extractPage, paragraphsOfHtml, textOfHtml } from './article-extraction.ts';
import { synthesizeArticle } from './article-synthesis.ts';
import type { FeedItem } from './feed-document.ts';
import { FetchFailure } from './limited-fetch.ts';
import type { CollectionRun } from './run-context.ts';
import { markSeen } from './seen-items.ts';
import { decodeText } from './text-decoding.ts';

/** An entry with the absolute link it is fetched from and the hash it is remembered by. */
export type Candidate = {
  item: FeedItem;
  link: string;
  urlHash: string;
  published: Date | null;
};

/**
 * Why an entry was skipped: no body could be extracted, it has no title, its word count is out
 * of the limits, its page failed for good, or an article with the same body exists.
 */
export type SkipReason =
  'no_body' | 'no_title' | 'word_count' | 'page_unavailable' | 'duplicate_body';

type EntryBody =
  | { kind: 'body'; title: string; paragraphs: string[] }
  | { kind: 'skip'; reason: SkipReason; detail?: string }
  | { kind: 'later'; detail: string };

type FeedPlace = { runId: string; feedKey: string; urlHash: string };

function withTitle(title: string, paragraphs: string[]): EntryBody {
  if (paragraphs.length === 0) {
    return { kind: 'skip', reason: 'no_body' };
  }
  const cleanTitle = normalizeParagraph(title);
  return cleanTitle
    ? { kind: 'body', title: cleanTitle, paragraphs }
    : { kind: 'skip', reason: 'no_title' };
}

async function pageBody(run: CollectionRun, candidate: Candidate, feedTitle: string) {
  let resource;
  try {
    resource = await run.fetchResource(candidate.link, 'page');
  } catch (error) {
    if (!(error instanceof FetchFailure)) {
      throw error;
    }
    const failed: EntryBody = error.temporary
      ? { kind: 'later', detail: error.message }
      : { kind: 'skip', reason: 'page_unavailable', detail: error.message };
    return failed;
  }
  const page = await extractPage(decodeText(resource.body, resource.contentType), resource.url);
  return withTitle(feedTitle || (page?.title ?? ''), page?.paragraphs ?? []);
}

async function entryBody(
  run: CollectionRun,
  source: 'feed' | 'page',
  candidate: Candidate,
): Promise<EntryBody> {
  const feedTitle = candidate.item.title ? await textOfHtml(candidate.item.title) : '';
  if (source === 'page') {
    return pageBody(run, candidate, feedTitle);
  }
  const content = candidate.item.content;
  return withTitle(feedTitle, content ? await paragraphsOfHtml(content) : []);
}

async function skip(run: CollectionRun, place: FeedPlace, reason: SkipReason, detail?: string) {
  await markSeen(run.database, place.urlHash, run.now());
  log('INFO', 'Entry skipped.', { ...place, reason, detail });
}

/** Writes the article, its sentences and the seen row; null when the body is already collected. */
async function insertArticle(
  run: CollectionRun,
  feedKey: string,
  candidate: Candidate,
  title: string,
  body: ArticleBody,
): Promise<string | null> {
  return run.database.transaction(async (tx) => {
    const now = run.now();
    const [article] = await tx
      .insert(articles)
      .values({
        feedKey,
        categoryKey: run.categoryOf(feedKey),
        sourceUrl: candidate.link,
        title,
        author: candidate.item.author ? normalizeParagraph(candidate.item.author) || null : null,
        bodyText: body.text,
        bodyHash: sha256Hex(body.text),
        state: 'preparing',
        retryAt: now,
      })
      .onConflictDoNothing({ target: articles.bodyHash })
      .returning({ id: articles.id });
    await markSeen(tx, candidate.urlHash, now);
    if (!article) {
      return null;
    }
    await tx.insert(articleSentences).values(
      body.sentences.map((sentence, sentenceIndex) => ({
        articleId: article.id,
        sentenceIndex,
        paragraphIndex: sentence.paragraphIndex,
        text: sentence.text,
        bodyStart: sentence.bodyStart,
        bodyEnd: sentence.bodyEnd,
      })),
    );
    return article.id;
  });
}

/** Collects one entry the feed's collection time took, then synthesizes its article. */
export async function collectEntry(
  run: CollectionRun,
  feedKey: string,
  source: 'feed' | 'page',
  candidate: Candidate,
): Promise<void> {
  const place: FeedPlace = { runId: run.runId, feedKey, urlHash: candidate.urlHash };
  const entry = await entryBody(run, source, candidate);
  if (entry.kind === 'later') {
    log('INFO', 'The original page failed for now; the entry may be tried again.', {
      ...place,
      detail: entry.detail,
    });
    return;
  }
  if (entry.kind === 'skip') {
    return skip(run, place, entry.reason, entry.detail);
  }
  const body = buildArticleBody(withoutTitleParagraph(entry.paragraphs, entry.title));
  if (!withinWordLimits(body.wordCount, run.config.words)) {
    return skip(run, place, 'word_count', `${body.wordCount} words`);
  }
  const articleId = await insertArticle(run, feedKey, candidate, entry.title, body);
  if (!articleId) {
    log('INFO', 'Entry skipped.', { ...place, reason: 'duplicate_body' });
    return;
  }
  log('INFO', 'Article collected.', {
    ...place,
    articleId,
    words: body.wordCount,
    sentences: body.sentences.length,
  });
  await synthesizeArticle(run, articleId);
}
