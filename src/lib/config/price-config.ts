// The price table usage records are estimated with (.docs/design/rules.md, 用量记录): one price
// per provider and model, in US dollars, as decimal strings so no amount passes through a float.
// A record keeps the table's version next to its estimate, so an estimate stays explainable after
// a price changes. Each price names the page it was read from and the day it was checked.
import { z } from 'zod';
import raw from '../../../config/prices.json' with { type: 'json' };
import { parseConfig } from './config-error.ts';

const plainName = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a plain lower-case name');

/** Dollars as a non-negative decimal with at most 12 places, such as "0.10". */
const dollars = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,12})?$/, 'must be a decimal amount of dollars such as "0.10"');

const origin = {
  provider: plainName,
  model: plainName,
  /** The official page the price was read from. */
  source: z.url({ protocol: /^https$/ }),
  checkedOn: z.iso.date(),
  note: z.string().max(300).optional(),
};

const tokenPrice = z.strictObject({
  ...origin,
  unit: z.literal('tokens'),
  usdPerMillionInputTokens: dollars,
  usdPerMillionOutputTokens: dollars,
});

const cpuPrice = z.strictObject({
  ...origin,
  unit: z.literal('cpu-seconds'),
  usdPerCpuSecond: dollars,
});

const pricesShape = z
  .strictObject({
    /** Recorded on every priced usage record. */
    version: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/, 'must be a short version name'),
    prices: z.array(z.discriminatedUnion('unit', [tokenPrice, cpuPrice])).min(1),
  })
  .superRefine((config, context) => {
    const seen = new Set<string>();
    config.prices.forEach((price, index) => {
      const key = `${price.provider}/${price.model}`;
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['prices', index],
          message: `repeats the price of ${key}`,
        });
      }
      seen.add(key);
    });
  });

export type PriceConfig = z.infer<typeof pricesShape>;

export type ModelPrice = PriceConfig['prices'][number];

export function parsePriceConfig(value: unknown): PriceConfig {
  return parseConfig('config/prices.json', pricesShape, value);
}

/** The price of a provider's model, or undefined when the table has none. */
export function priceOf(
  config: PriceConfig,
  provider: string,
  model: string,
): ModelPrice | undefined {
  return config.prices.find((price) => price.provider === provider && price.model === model);
}

/** The committed price table, validated when this module loads. */
export const priceConfig: PriceConfig = parsePriceConfig(raw);
