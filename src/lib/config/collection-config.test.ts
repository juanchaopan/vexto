import { describe, expect, it } from 'vitest';
import committed from '../../../config/collection.json' with { type: 'json' };
import { cloudRunDeployments } from '../../../scripts/lib/cloud-run.ts';
import {
  collectionConfig,
  estimateMonthlySynthesis,
  monthlySynthesisBudget,
  parseCollectionConfig,
  plannedArticlesPerDay,
  synthesisUsageOf,
  type CollectionConfig,
} from './collection-config.ts';
import { ConfigError } from './config-error.ts';
import { sharedConfig } from './shared-config.ts';

function variant(change: (config: CollectionConfig) => void): CollectionConfig {
  const config = structuredClone(committed) as CollectionConfig;
  change(config);
  return config;
}

function problems(value: unknown) {
  try {
    parseCollectionConfig(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('The configuration passed its validation.');
}

const feedKeys = Object.keys(committed.feeds);

/** Sets the per-run count of every feed. */
function perRun(count: number) {
  return (config: CollectionConfig) => {
    for (const feed of Object.values(config.feeds)) {
      feed.perRun = count;
    }
  };
}

describe('the committed collection configuration', () => {
  it('passes its validation', () => {
    expect(parseCollectionConfig(committed)).toEqual(collectionConfig);
  });

  it('collects every feed of the shared configuration twice a day at 09:00 in New York', () => {
    expect(feedKeys).toEqual(sharedConfig.feeds.map((feed) => feed.key));
    for (const feed of Object.values(collectionConfig.feeds)) {
      expect(feed).toMatchObject({
        timeZone: 'America/New_York',
        times: ['09:00'],
        perRun: 2,
        enabled: true,
      });
    }
  });

  it('has the global values of the first version', () => {
    expect(collectionConfig).toMatchObject({
      words: { min: 150, max: 1000 },
      planningAverageWords: 600,
      dailyArticleLimit: 10,
      job: { vcpu: 2, memoryGiB: 2 },
      freeTier: { vcpuSeconds: 240000, gibSeconds: 450000 },
      budgetRatio: 0.8,
      storage: { capBytes: 5_000_000_000, evictAtRatio: 0.95, evictToRatio: 0.9 },
    });
  });

  it('gives the job the vCPUs and memory the Cloud Run job is deployed with', () => {
    const job = cloudRunDeployments.find((deployment) => deployment.resource === 'vexto-collect');

    expect(job?.cpu).toBe(String(collectionConfig.job.vcpu));
    expect(job?.memory).toBe(`${collectionConfig.job.memoryGiB}Gi`);
  });
});

describe('the synthesis estimate', () => {
  it('is about 168640 vCPU-seconds and GiB-seconds a month for the first version', () => {
    // W = 5 feeds × 2 articles × 600 words = 6000 words a day;
    // C = 6000 ÷ 150 × 136 × 31 = 168640 vCPU-seconds; GiB-seconds = C ÷ 2 vCPU × 2 GiB.
    expect(plannedArticlesPerDay(collectionConfig)).toBe(10);
    expect(estimateMonthlySynthesis(collectionConfig)).toEqual({
      vcpuSeconds: 168640,
      gibSeconds: 168640,
    });
  });

  it('is measured against 80% of the Cloud Run job free tier', () => {
    const budget = monthlySynthesisBudget(collectionConfig);

    expect(budget.vcpuSeconds).toBeCloseTo(192000, 6);
    expect(budget.gibSeconds).toBeCloseTo(360000, 6);
  });

  it('turns synthesis seconds into vCPU-seconds and GiB-seconds of the job', () => {
    expect(synthesisUsageOf(collectionConfig, 450)).toEqual({ vcpuSeconds: 900, gibSeconds: 900 });
    const bigger = variant((c) => (c.job = { vcpu: 4, memoryGiB: 8 }));
    expect(synthesisUsageOf(bigger, 10)).toEqual({ vcpuSeconds: 40, gibSeconds: 80 });
  });

  it('leaves disabled feeds out', () => {
    const config = variant((c) => (c.feeds['nist-news'].enabled = false));

    expect(plannedArticlesPerDay(config)).toBe(8);
    expect(estimateMonthlySynthesis(config).vcpuSeconds).toBeCloseTo(134912, 6);
  });
});

describe('parseCollectionConfig', () => {
  it('refuses a plan of more articles a day than the daily limit', () => {
    const config = variant((c) => (c.feeds['nasa-technology'].times = ['09:00', '18:00']));

    expect(problems(config)).toMatch(
      /feeds plan 12 articles a day, more than the daily limit of 10/,
    );
  });

  it('refuses a plan whose estimated vCPU-seconds exceed the budget', () => {
    // 10 articles of 700 words: 7000 ÷ 150 × 136 × 31 ≈ 196747 vCPU-seconds, over 192000.
    const config = variant((c) => (c.planningAverageWords = 700));

    expect(problems(config)).toMatch(
      /feeds need an estimated 196747 vcpuSeconds a month, more than the budget of 192000/,
    );
    expect(problems(config)).not.toMatch(/gibSeconds/);
  });

  it('refuses a plan whose estimated GiB-seconds exceed the budget', () => {
    // With 4 GiB per vCPU the run time on 8 GiB gives 4 × 168640 = 674560 GiB-seconds.
    const config = variant((c) => (c.job = { vcpu: 2, memoryGiB: 8 }));

    expect(problems(config)).toMatch(
      /feeds need an estimated 674560 gibSeconds a month, more than the budget of 360000/,
    );
    expect(problems(config)).not.toMatch(/vcpuSeconds/);
  });

  it('accepts a plan just inside the budget and refuses more feeds than the budget allows', () => {
    // 680 words: 6800 ÷ 150 × 136 × 31 ≈ 191125 vCPU-seconds, under 192000.
    expect(() =>
      parseCollectionConfig(variant((c) => (c.planningAverageWords = 680))),
    ).not.toThrow();
    const raised = variant((c) => {
      perRun(3)(c);
      c.dailyArticleLimit = 15;
    });
    expect(problems(raised)).toMatch(/vcpuSeconds a month, more than the budget/);
  });

  it('refuses word limits out of order and a planning average outside them', () => {
    expect(problems(variant((c) => (c.words = { min: 1000, max: 150 })))).toMatch(
      /words min must be below max/,
    );
    expect(problems(variant((c) => (c.planningAverageWords = 100)))).toMatch(
      /planningAverageWords must be within the word limits/,
    );
  });

  it('refuses a budget ratio outside (0, 1] and eviction ratios out of order', () => {
    expect(problems(variant((c) => (c.budgetRatio = 0)))).toMatch(/budgetRatio/);
    expect(problems(variant((c) => (c.budgetRatio = 1.2)))).toMatch(/budgetRatio/);
    expect(problems(variant((c) => (c.storage.evictToRatio = 0.95)))).toMatch(
      /storage\.evictToRatio must be below evictAtRatio/,
    );
  });

  it('refuses feed URLs and the repository URL that are not https', () => {
    expect(
      problems(variant((c) => (c.feeds['nist-news'].url = 'http://www.nist.gov/news.xml'))),
    ).toMatch(/feeds\.nist-news\.url must be an https URL/);
    expect(problems(variant((c) => (c.repositoryUrl = 'not a url')))).toMatch(/repositoryUrl/);
  });

  it('refuses an unknown time zone, malformed or repeated times, and an unknown body source', () => {
    const feed = 'nasa-aeronautics';
    expect(problems(variant((c) => (c.feeds[feed].timeZone = 'Mars/Olympus')))).toMatch(
      /feeds\.nasa-aeronautics\.timeZone must be an IANA time zone/,
    );
    expect(problems(variant((c) => (c.feeds[feed].times = ['9:00'])))).toMatch(/times\.0/);
    expect(problems(variant((c) => (c.feeds[feed].times = ['24:00'])))).toMatch(/times\.0/);
    expect(problems(variant((c) => (c.feeds[feed].times = [])))).toMatch(/times/);
    expect(problems(variant((c) => (c.feeds[feed].times = ['09:00', '09:00'])))).toMatch(
      /must not repeat a time/,
    );
    expect(problems(variant((c) => Object.assign(c.feeds[feed], { body: 'html' })))).toMatch(
      /feeds\.nasa-aeronautics\.body/,
    );
  });

  it('refuses a per-run count that is not a positive whole number', () => {
    expect(problems(variant((c) => (c.feeds['nist-news'].perRun = 0)))).toMatch(/perRun/);
    expect(problems(variant((c) => (c.feeds['nist-news'].perRun = 1.5)))).toMatch(/perRun/);
  });

  it('refuses collection settings of a feed the shared configuration does not show', () => {
    const config = variant(
      (c) => (c.feeds['nasa-science'] = { ...c.feeds['nasa-technology'], enabled: false }),
    );

    expect(problems(config)).toMatch(/feeds\.nasa-science is not a feed of config\/shared\.json/);
  });

  it('refuses a shown feed without collection settings', () => {
    const config = variant((c) => delete c.feeds['loc-inside-adams']);

    expect(problems(config)).toMatch(/no collection settings for loc-inside-adams/);
  });

  it('refuses fields it does not know', () => {
    expect(problems(variant((c) => Object.assign(c, { feedsPerDay: 10 })))).toMatch(/\(root\)/);
  });
});
