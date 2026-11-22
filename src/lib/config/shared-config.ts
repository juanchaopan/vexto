// The configuration the browser and the server both read (config/shared.json): the terms version
// and date, the categories, and how each feed is shown, with its name, category, letter mark,
// colour, attribution and licence. It is bundled into the browser, so it holds nothing that is
// only for the server; how and when each feed is collected is in config/collection.json.
import { z } from 'zod';
import raw from '../../../config/shared.json' with { type: 'json' };
import { parseConfig } from './config-error.ts';

const key = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lower-case words joined by hyphens');
const name = z.string().trim().min(1, 'must not be empty');
const httpsUrl = z.url().refine((url) => url.startsWith('https://'), 'must be an https URL');

const categorySchema = z.strictObject({ key, name });

const feedDisplaySchema = z.strictObject({
  key,
  name,
  category: key,
  mark: z.string().regex(/^[A-Za-z]{1,2}$/, 'must be one or two letters'),
  color: z.string().regex(/^#[0-9a-f]{6}$/, 'must be a lower-case hex colour such as #245ab8'),
  attribution: name,
  /** Only sources whose licence must be shown, such as CC BY, have one. */
  license: z.strictObject({ name, url: httpsUrl }).optional(),
});

function duplicates(values: readonly string[]) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

export const sharedConfigSchema = z
  .strictObject({
    terms: z.strictObject({
      version: z.number().int().min(1),
      date: z.iso.date(),
    }),
    categories: z.array(categorySchema).min(1),
    feeds: z.array(feedDisplaySchema).min(1),
  })
  .superRefine((config, context) => {
    for (const [list, keys] of [
      ['categories', config.categories.map((category) => category.key)],
      ['feeds', config.feeds.map((feed) => feed.key)],
    ] as const) {
      for (const duplicate of new Set(duplicates(keys))) {
        context.addIssue({ code: 'custom', path: [list], message: `repeat the key ${duplicate}` });
      }
    }
    const categories = new Set(config.categories.map((category) => category.key));
    config.feeds.forEach((feed, index) => {
      if (!categories.has(feed.category)) {
        context.addIssue({
          code: 'custom',
          path: ['feeds', index, 'category'],
          message: `is not one of the categories (${feed.category})`,
        });
      }
    });
  });

export type SharedConfig = z.infer<typeof sharedConfigSchema>;
export type Category = SharedConfig['categories'][number];
export type FeedDisplay = SharedConfig['feeds'][number];

export function parseSharedConfig(value: unknown): SharedConfig {
  return parseConfig('config/shared.json', sharedConfigSchema, value);
}

/** The committed shared configuration, validated when this module loads. */
export const sharedConfig: SharedConfig = parseSharedConfig(raw);
