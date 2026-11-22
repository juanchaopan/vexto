// The configuration only the server reads (config/collection.json): how and when each feed is
// collected, the article word limits, the synthesis budget and the storage cap
// (.docs/design/rules.md, 订阅源 and 合成预算). Validation also checks the whole configuration
// against the free tier: the enabled feeds may not plan more articles a day than the daily limit,
// and their estimated monthly synthesis may not exceed the budget, which is the Cloud Run job's
// free tier times the budget ratio.
import { z } from 'zod';
import raw from '../../../config/collection.json' with { type: 'json' };
import { parseConfig } from './config-error.ts';
import { sharedConfig, type SharedConfig } from './shared-config.ts';

const positiveInt = z.number().int().positive();
const positive = z.number().positive();
const ratio = z.number().gt(0).max(1);

function isTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const feedCollectionSchema = z.strictObject({
  url: z.url().refine((url) => url.startsWith('https://'), 'must be an https URL'),
  /** `feed` uses the item's own content; `page` fetches the original page. */
  body: z.enum(['feed', 'page']),
  timeZone: z.string().refine(isTimeZone, 'must be an IANA time zone'),
  /** Local collection times, HH:MM on a 24-hour clock. */
  times: z
    .array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'must be a time such as 09:00'))
    .min(1)
    .refine((times) => new Set(times).size === times.length, 'must not repeat a time'),
  perRun: positiveInt,
  enabled: z.boolean(),
});

const collectionShape = z.strictObject({
  /** Written into the User-Agent of every fetch. */
  repositoryUrl: z.url().refine((url) => url.startsWith('https://'), 'must be an https URL'),
  words: z.strictObject({ min: positiveInt, max: positiveInt }),
  /** Used only to estimate the monthly synthesis. */
  planningAverageWords: positiveInt,
  dailyArticleLimit: positiveInt,
  /** The collection job's resources, the same as the Cloud Run job's settings. */
  job: z.strictObject({ vcpu: positive, memoryGiB: positive }),
  /** The Cloud Run job free tier per month. */
  freeTier: z.strictObject({ vcpuSeconds: positive, gibSeconds: positive }),
  budgetRatio: ratio,
  /** How long synthesis takes: words read per audio minute and vCPU-seconds per audio minute. */
  synthesisEstimate: z.strictObject({
    wordsPerMinute: positive,
    vcpuSecondsPerAudioMinute: positive,
    daysPerMonth: positiveInt,
  }),
  /** Audio storage cap; eviction starts at the first ratio and goes down below the second. */
  storage: z.strictObject({
    capBytes: positiveInt,
    evictAtRatio: ratio,
    evictToRatio: ratio,
    evictBatchSize: positiveInt,
  }),
  feeds: z.record(z.string(), feedCollectionSchema),
});

export type CollectionConfig = z.infer<typeof collectionShape>;
export type FeedCollection = CollectionConfig['feeds'][string];

export type SynthesisUsage = { vcpuSeconds: number; gibSeconds: number };

function enabledFeeds(config: CollectionConfig) {
  return Object.values(config.feeds).filter((feed) => feed.enabled);
}

/** Articles the enabled feeds can collect in a day: per run times collection times, summed. */
export function plannedArticlesPerDay(config: CollectionConfig): number {
  return enabledFeeds(config).reduce((sum, feed) => sum + feed.perRun * feed.times.length, 0);
}

/** The month's synthesis budget: the free tier times the budget ratio, for each measure. */
export function monthlySynthesisBudget(config: CollectionConfig): SynthesisUsage {
  return {
    vcpuSeconds: config.freeTier.vcpuSeconds * config.budgetRatio,
    gibSeconds: config.freeTier.gibSeconds * config.budgetRatio,
  };
}

/** The usage of synthesis that ran this many seconds on the job's vCPUs and memory. */
export function synthesisUsageOf(config: CollectionConfig, seconds: number): SynthesisUsage {
  return {
    vcpuSeconds: seconds * config.job.vcpu,
    gibSeconds: seconds * config.job.memoryGiB,
  };
}

/**
 * The monthly synthesis the enabled feeds are planned to need, from the average article length:
 * W words a day are W ÷ words-per-minute audio minutes, each taking the measured vCPU-seconds,
 * over the days of a month; the GiB-seconds follow from the run time on the job's memory.
 */
export function estimateMonthlySynthesis(config: CollectionConfig): SynthesisUsage {
  const wordsPerDay = plannedArticlesPerDay(config) * config.planningAverageWords;
  const estimate = config.synthesisEstimate;
  const vcpuSeconds =
    (wordsPerDay / estimate.wordsPerMinute) *
    estimate.vcpuSecondsPerAudioMinute *
    estimate.daysPerMonth;
  return synthesisUsageOf(config, vcpuSeconds / config.job.vcpu);
}

type Context = z.RefinementCtx;

function checkLimits(config: CollectionConfig, context: Context) {
  if (config.words.min >= config.words.max) {
    context.addIssue({ code: 'custom', path: ['words'], message: 'min must be below max' });
  }
  const average = config.planningAverageWords;
  if (average < config.words.min || average > config.words.max) {
    context.addIssue({
      code: 'custom',
      path: ['planningAverageWords'],
      message: 'must be within the word limits',
    });
  }
  if (config.storage.evictToRatio >= config.storage.evictAtRatio) {
    context.addIssue({
      code: 'custom',
      path: ['storage', 'evictToRatio'],
      message: 'must be below evictAtRatio',
    });
  }
}

function checkPlan(config: CollectionConfig, context: Context) {
  const perDay = plannedArticlesPerDay(config);
  if (perDay > config.dailyArticleLimit) {
    context.addIssue({
      code: 'custom',
      path: ['feeds'],
      message: `plan ${perDay} articles a day, more than the daily limit of ${config.dailyArticleLimit}`,
    });
  }
  const estimate = estimateMonthlySynthesis(config);
  const budget = monthlySynthesisBudget(config);
  for (const measure of ['vcpuSeconds', 'gibSeconds'] as const) {
    if (estimate[measure] > budget[measure]) {
      context.addIssue({
        code: 'custom',
        path: ['feeds'],
        message: `need an estimated ${Math.round(estimate[measure])} ${measure} a month, more than the budget of ${Math.round(budget[measure])}`,
      });
    }
  }
}

function checkFeedKeys(config: CollectionConfig, shared: SharedConfig, context: Context) {
  const shown = new Set(shared.feeds.map((feed) => feed.key));
  for (const key of Object.keys(config.feeds)) {
    if (!shown.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['feeds', key],
        message: 'is not a feed of config/shared.json',
      });
    }
  }
  for (const key of shown) {
    if (!(key in config.feeds)) {
      context.addIssue({
        code: 'custom',
        path: ['feeds'],
        message: `have no collection settings for ${key} of config/shared.json`,
      });
    }
  }
}

/** The collection configuration's schema, checked against the feeds the shared one shows. */
export function collectionConfigSchema(shared: SharedConfig) {
  return collectionShape.superRefine((config, context) => {
    checkLimits(config, context);
    checkPlan(config, context);
    checkFeedKeys(config, shared, context);
  });
}

export function parseCollectionConfig(
  value: unknown,
  shared: SharedConfig = sharedConfig,
): CollectionConfig {
  return parseConfig('config/collection.json', collectionConfigSchema(shared), value);
}

/** The committed collection configuration, validated when this module loads. */
export const collectionConfig: CollectionConfig = parseCollectionConfig(raw);
