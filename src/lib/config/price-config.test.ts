import { describe, expect, it } from 'vitest';
import committedAi from '../../../config/ai.json' with { type: 'json' };
import committed from '../../../config/prices.json' with { type: 'json' };
import { ConfigError } from './config-error.ts';
import { parsePriceConfig, priceConfig, priceOf } from './price-config.ts';
import { speechConfig } from './speech-config.ts';

function problems(value: unknown) {
  try {
    parsePriceConfig(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('The configuration passed its validation.');
}

const [openai] = committed.prices;

describe('priceConfig', () => {
  it('prices the configured AI model and the speech model', () => {
    expect(priceOf(priceConfig, committedAi.provider, committedAi.model)).toMatchObject({
      unit: 'tokens',
      usdPerMillionInputTokens: '0.10',
      usdPerMillionOutputTokens: '0.50',
      source: expect.stringMatching(/^https:\/\//),
    });
    expect(priceOf(priceConfig, speechConfig.provider, speechConfig.model)).toMatchObject({
      unit: 'cpu-seconds',
    });
  });

  it('finds no price for a model the table does not list', () => {
    expect(priceOf(priceConfig, 'openai', 'unknown-model')).toBeUndefined();
  });
});

describe('parsePriceConfig', () => {
  it('refuses an amount that is not a plain decimal', () => {
    expect(
      problems({ ...committed, prices: [{ ...openai, usdPerMillionInputTokens: '1e-3' }] }),
    ).toMatch(/config\/prices\.json is invalid: prices\.0\.usdPerMillionInputTokens/);
    expect(
      problems({ ...committed, prices: [{ ...openai, usdPerMillionOutputTokens: -1 }] }),
    ).toContain('usdPerMillionOutputTokens');
  });

  it('refuses two prices for the same model', () => {
    expect(problems({ ...committed, prices: [openai, openai] })).toContain('repeats the price');
  });

  it('refuses a price without an https source', () => {
    expect(
      problems({ ...committed, prices: [{ ...openai, source: 'http://example.com' }] }),
    ).toContain('source');
  });
});
