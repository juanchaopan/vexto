// Articles the collection job writes, their sentences with the timeline, and each member's visits
// (.docs/design/data.md, 文章). Indexes follow the sorts, filters and searches of the article list.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  englishDocument,
  isBetween,
  isOneOf,
  timestamptz,
  tsvector,
  uuidPrimaryKey,
} from '../../../lib/db/columns.ts';
import { members } from '../../account/index.ts';
import { audioAssets } from '../../audio/index.ts';
import {
  ARTICLE_STATES,
  MAX_SYNTHESIS_ATTEMPTS,
  SYNTHESIS_ERROR_CODES,
  type ArticleState,
  type SynthesisErrorCode,
} from '../domain/article.ts';

export const articles = pgTable(
  'articles',
  {
    id: uuidPrimaryKey(),
    feedKey: text('feed_key').notNull(),
    categoryKey: text('category_key').notNull(),
    sourceUrl: text('source_url').notNull(),
    title: text('title').notNull(),
    author: text('author'),
    bodyText: text('body_text').notNull(),
    bodyHash: text('body_hash').notNull().unique('articles_body_hash_key'),
    bodyFts: tsvector('body_fts')
      .notNull()
      .generatedAlwaysAs(englishDocument((): AnyPgColumn => articles.bodyText)),
    state: text('state').$type<ArticleState>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    retryAt: timestamptz('retry_at'),
    lastErrorCode: text('last_error_code').$type<SynthesisErrorCode>(),
    audioAssetId: uuid('audio_asset_id').references(() => audioAssets.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    collectedAt: timestamptz('collected_at'),
  },
  (t) => [
    index('articles_state_collected_at_id_idx').on(t.state, t.collectedAt, t.id),
    index('articles_state_title_id_idx').on(t.state, sql`lower(${t.title})`, t.id),
    index('articles_state_feed_key_id_idx').on(t.state, t.feedKey, t.id),
    index('articles_state_category_key_id_idx').on(t.state, t.categoryKey, t.id),
    index('articles_body_fts_idx').using('gin', t.bodyFts),
    index('articles_state_retry_at_idx').on(t.state, t.retryAt),
    check('articles_state_check', isOneOf(t.state, ARTICLE_STATES)),
    check('articles_attempts_check', isBetween(t.attempts, 0, MAX_SYNTHESIS_ATTEMPTS)),
    check('articles_last_error_code_check', isOneOf(t.lastErrorCode, SYNTHESIS_ERROR_CODES)),
    check(
      'articles_ready_check',
      sql`${t.state} <> 'ready' or (${t.audioAssetId} is not null and ${t.collectedAt} is not null)`,
    ),
  ],
);

export const articleSentences = pgTable(
  'article_sentences',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    sentenceIndex: integer('sentence_index').notNull(),
    paragraphIndex: integer('paragraph_index').notNull(),
    text: text('text').notNull(),
    bodyStart: integer('body_start').notNull(),
    bodyEnd: integer('body_end').notNull(),
    startMs: integer('start_ms'),
    endMs: integer('end_ms'),
  },
  (t) => [primaryKey({ name: 'article_sentences_pkey', columns: [t.articleId, t.sentenceIndex] })],
);

export const visits = pgTable(
  'visits',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => members.id),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    lastOpenedAt: timestamptz('last_opened_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'visits_pkey', columns: [t.ownerId, t.articleId] }),
    index('visits_owner_id_last_opened_at_article_id_idx').on(
      t.ownerId,
      t.lastOpenedAt,
      t.articleId,
    ),
  ],
);
