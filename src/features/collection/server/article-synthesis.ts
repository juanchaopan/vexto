// Synthesis and publishing of a collected article (.docs/design/rules.md, 合成和发布, 合成预算 and
// 失败和重试). Before an attempt the run checks its synthesis window, the month's budget and the
// storage cap. The attempt is counted, with its retry time and `interrupted` as the error, before
// the synthesis starts, so an article whose run stops in the middle is retried on time and fails
// once its attempts are used. The synthesizer is called outside any transaction; publishing then
// marks the audio and the article ready and writes the timeline in one transaction, after checking
// that neither changed meanwhile.
import { and, asc, eq, lte, sql, TransactionRollbackError } from 'drizzle-orm';
import { z } from 'zod';
import { monthlySynthesisBudget, synthesisUsageOf } from '../../../lib/config/collection-config.ts';
import type { Transaction } from '../../../lib/db/client.ts';
import { errorFields, log } from '../../../lib/log.ts';
import { articleSentences, articles, MAX_SYNTHESIS_ATTEMPTS } from '../../articles/index.ts';
import { articleAudioRow, markAudioReady } from '../../audio/index.ts';
import { trackUsage, type UsageOutcome } from '../../usage/index.ts';
import { countWords } from '../domain/article-body.ts';
import { retryTime } from '../domain/retry.ts';
import {
  budgetReached,
  isLastAttempt,
  nextSynthesisStep,
  nextUtcMonthStart,
  utcMonthOf,
} from '../domain/synthesis-plan.ts';
import {
  ArticleSynthesisError,
  type ArticleSynthesizer,
  type SentenceTiming,
  type SynthesizedArticle,
} from './article-synthesizer.ts';
import type { CollectionRun } from './run-context.ts';
import { addSynthesisSeconds, synthesisSecondsOf } from './synthesis-months.ts';

type PreparingArticle = { id: string; attempts: number; bodyText: string };

const synthesizedSchema = z.object({
  byteSize: z.int().positive(),
  durationMs: z.int().positive(),
  cpuMs: z.int().nonnegative(),
  sentenceTimings: z.array(z.object({ startMs: z.int().nonnegative(), endMs: z.int() })),
});

/** Timings that cover the sentences in order, inside the audio, never going back. */
function timingsFit(timings: readonly SentenceTiming[], count: number, durationMs: number) {
  return (
    timings.length === count &&
    timings.every(
      (timing, index) =>
        timing.startMs <= timing.endMs &&
        timing.endMs <= durationMs &&
        (index === 0 || timing.startMs >= timings[index - 1].endMs),
    )
  );
}

function checkedResult(result: unknown, sentenceCount: number): SynthesizedArticle {
  const parsed = synthesizedSchema.safeParse(result);
  if (
    !parsed.success ||
    !timingsFit(parsed.data.sentenceTimings, sentenceCount, parsed.data.durationMs)
  ) {
    throw new ArticleSynthesisError(
      'tts_error',
      'The synthesizer returned audio that does not fit the sentences.',
    );
  }
  return parsed.data;
}

function outcomeOfError(error: unknown): UsageOutcome {
  return {
    status: 'failed',
    errorCode: error instanceof ArticleSynthesisError ? error.code : 'internal',
  };
}

async function preparingArticle(run: CollectionRun, articleId: string) {
  const [article] = await run.database
    .select({ id: articles.id, attempts: articles.attempts, bodyText: articles.bodyText })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.state, 'preparing')));
  return article as PreparingArticle | undefined;
}

async function sentenceTexts(run: CollectionRun, articleId: string) {
  const rows = await run.database
    .select({ text: articleSentences.text })
    .from(articleSentences)
    .where(eq(articleSentences.articleId, articleId))
    .orderBy(asc(articleSentences.sentenceIndex));
  return rows.map((row) => row.text);
}

async function monthBudgetReached(run: CollectionRun) {
  const seconds = await synthesisSecondsOf(run.database, utcMonthOf(run.now()));
  return budgetReached(synthesisUsageOf(run.config, seconds), monthlySynthesisBudget(run.config));
}

function whilePreparing(articleId: string, attempts: number) {
  return and(
    eq(articles.id, articleId),
    eq(articles.state, 'preparing'),
    eq(articles.attempts, attempts),
  );
}

async function giveUp(run: CollectionRun, article: PreparingArticle) {
  await run.database
    .update(articles)
    .set({
      state: 'failed',
      retryAt: null,
      lastErrorCode: sql`coalesce(${articles.lastErrorCode}, 'interrupted')`,
    })
    .where(whilePreparing(article.id, article.attempts));
  log('WARNING', 'Article failed: its last synthesis attempt stopped in the middle.', {
    runId: run.runId,
    articleId: article.id,
    attempts: article.attempts,
  });
}

async function deferToNextMonth(run: CollectionRun, article: PreparingArticle) {
  const retryAt = nextUtcMonthStart(run.now());
  await run.database
    .update(articles)
    .set({ retryAt })
    .where(whilePreparing(article.id, article.attempts));
  log('INFO', 'The synthesis budget of the month is spent; the article waits.', {
    runId: run.runId,
    articleId: article.id,
    retryAt: retryAt.toISOString(),
  });
}

/** Counts the attempt before it starts; false when the article changed since it was read. */
async function startAttempt(run: CollectionRun, article: PreparingArticle, attempt: number) {
  const started = await run.database
    .update(articles)
    .set({
      attempts: attempt,
      retryAt: retryTime(run.now(), attempt),
      lastErrorCode: 'interrupted',
    })
    .where(whilePreparing(article.id, article.attempts))
    .returning({ id: articles.id });
  return started.length === 1;
}

/** Runs the synthesis and adds its run time to the month's tally, whether it succeeds or not. */
async function timed<T>(run: CollectionRun, work: () => Promise<T>): Promise<T> {
  const started = run.elapsedMs();
  try {
    return await work();
  } finally {
    const seconds = (run.elapsedMs() - started) / 1000;
    await addSynthesisSeconds(run.database, utcMonthOf(run.now()), seconds);
  }
}

function trackedSynthesis(
  run: CollectionRun,
  synthesizer: ArticleSynthesizer,
  articleId: string,
  objectKey: string,
  sentences: readonly string[],
) {
  const { voice } = synthesizer;
  const start = {
    kind: 'article_tts' as const,
    provider: voice.provider,
    model: voice.model,
    engineRevision: voice.modelRevision,
    resourceType: 'article',
    resourceId: articleId,
  };
  return trackUsage(
    run.database,
    start,
    async () => {
      const result = await synthesizer.synthesize({ articleId, objectKey, sentences });
      const synthesized = checkedResult(result, sentences.length);
      const outcome: UsageOutcome = {
        status: 'succeeded',
        audioMs: synthesized.durationMs,
        cpuMs: synthesized.cpuMs,
        byteCount: synthesized.byteSize,
      };
      return { result: synthesized, outcome };
    },
    outcomeOfError,
  );
}

async function recordFailure(
  run: CollectionRun,
  articleId: string,
  attempt: number,
  error: ArticleSynthesisError,
) {
  const last = isLastAttempt(attempt, MAX_SYNTHESIS_ATTEMPTS);
  await run.database
    .update(articles)
    .set(
      last
        ? { lastErrorCode: error.code, state: 'failed', retryAt: null }
        : { lastErrorCode: error.code },
    )
    .where(whilePreparing(articleId, attempt));
  log(
    'WARNING',
    last ? 'Article failed: its last synthesis failed.' : 'Article synthesis failed.',
    {
      runId: run.runId,
      articleId,
      attempt,
      code: error.code,
      ...errorFields(error),
    },
  );
}

async function writeTimings(
  tx: Transaction,
  articleId: string,
  timings: readonly SentenceTiming[],
) {
  const rows = sql.join(
    timings.map(
      (timing, index) => sql`(${index}::int, ${timing.startMs}::int, ${timing.endMs}::int)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    update ${articleSentences} as s
    set start_ms = v.start_ms, end_ms = v.end_ms
    from (values ${rows}) as v (sentence_index, start_ms, end_ms)
    where s.article_id = ${articleId} and s.sentence_index = v.sentence_index`);
}

/** Publishes in one transaction; false when the audio row or the article changed meanwhile. */
async function publish(
  run: CollectionRun,
  articleId: string,
  attempt: number,
  audioId: string,
  synthesized: SynthesizedArticle,
): Promise<boolean> {
  try {
    await run.database.transaction(async (tx) => {
      if (!(await markAudioReady(tx, audioId, synthesized))) {
        tx.rollback();
      }
      const published = await tx
        .update(articles)
        .set({
          state: 'ready',
          audioAssetId: audioId,
          collectedAt: run.now(),
          retryAt: null,
          lastErrorCode: null,
        })
        .where(whilePreparing(articleId, attempt))
        .returning({ id: articles.id });
      if (published.length !== 1) {
        tx.rollback();
      }
      await writeTimings(tx, articleId, synthesized.sentenceTimings);
    });
    return true;
  } catch (error) {
    if (error instanceof TransactionRollbackError) {
      return false;
    }
    throw error;
  }
}

async function attemptSynthesis(run: CollectionRun, article: PreparingArticle) {
  const sentences = await sentenceTexts(run, article.id);
  await run.storageRoom.makeRoomFor({
    articleId: article.id,
    wordCount: countWords(article.bodyText),
    sentenceCount: sentences.length,
  });
  const attempt = article.attempts + 1;
  if (!(await startAttempt(run, article, attempt))) {
    return;
  }
  const synthesizer = await run.synthesizer();
  const audio = await articleAudioRow(run.database, article.id, synthesizer.voice);
  let synthesized: SynthesizedArticle;
  try {
    synthesized = await timed(run, () =>
      trackedSynthesis(run, synthesizer, article.id, audio.objectKey, sentences),
    );
  } catch (error) {
    if (error instanceof ArticleSynthesisError) {
      await recordFailure(run, article.id, attempt, error);
      return;
    }
    throw error;
  }
  const published = await publish(run, article.id, attempt, audio.id, synthesized);
  log(
    published ? 'INFO' : 'WARNING',
    published
      ? 'Article published.'
      : 'Article changed during its synthesis and was not published.',
    {
      runId: run.runId,
      articleId: article.id,
      attempt,
      audioMs: synthesized.durationMs,
    },
  );
}

/**
 * Synthesizes one preparing article, or does what its state calls for instead: it fails when
 * its attempts are used, waits for the next run once the synthesis window has passed, or waits
 * for the next month when the budget is spent.
 */
export async function synthesizeArticle(run: CollectionRun, articleId: string): Promise<void> {
  const article = await preparingArticle(run, articleId);
  if (!article) {
    return;
  }
  const step = nextSynthesisStep({
    attempts: article.attempts,
    maxAttempts: MAX_SYNTHESIS_ATTEMPTS,
    windowOpen: run.elapsedMs() < run.synthesisWindowMs,
    budgetReached: await monthBudgetReached(run),
  });
  switch (step) {
    case 'give-up':
      return giveUp(run, article);
    case 'wait-for-next-run':
      return;
    case 'defer-to-next-month':
      return deferToNextMonth(run, article);
    case 'synthesize':
      return attemptSynthesis(run, article);
  }
}

/** Synthesizes every preparing article whose retry time has come, the earliest first. */
export async function synthesizeDueArticles(run: CollectionRun): Promise<void> {
  const due = await run.database
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.state, 'preparing'), lte(articles.retryAt, run.now())))
    .orderBy(asc(articles.retryAt), asc(articles.id));
  for (const { id } of due) {
    await synthesizeArticle(run, id);
  }
}
