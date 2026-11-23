import { describe, expect, it } from 'vitest';
import committed from '../../../config/shared.json' with { type: 'json' };
import { ConfigError } from './config-error.ts';
import { parseSharedConfig, sharedConfig, type SharedConfig } from './shared-config.ts';

function variant(change: (config: SharedConfig) => void): unknown {
  const config = structuredClone(committed) as SharedConfig;
  change(config);
  return config;
}

function problems(value: unknown) {
  try {
    parseSharedConfig(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('The configuration passed its validation.');
}

describe('the committed shared configuration', () => {
  it('passes its validation', () => {
    expect(parseSharedConfig(committed)).toEqual(sharedConfig);
  });

  it('has terms version 1, the four categories and the five feeds of the first version', () => {
    expect(sharedConfig.terms).toEqual({ version: 1, date: '2026-11-22' });
    expect(sharedConfig.categories.map((category) => category.key)).toEqual([
      'technology',
      'science',
      'health',
      'history',
    ]);
    expect(sharedConfig.feeds.map((feed) => [feed.key, feed.category, feed.mark])).toEqual([
      ['nasa-technology', 'technology', 'NT'],
      ['nasa-aeronautics', 'science', 'NA'],
      ['nih-research-matters', 'health', 'NH'],
      ['nist-news', 'technology', 'NS'],
      ['loc-inside-adams', 'history', 'IA'],
    ]);
  });
});

describe('parseSharedConfig', () => {
  it('refuses a terms version below 1 and a date that is not a date', () => {
    expect(problems(variant((c) => (c.terms.version = 0)))).toMatch(/terms\.version/);
    expect(problems(variant((c) => (c.terms.date = 'November 22, 2026')))).toMatch(/terms\.date/);
  });

  it('refuses repeated category and feed keys', () => {
    expect(problems(variant((c) => (c.categories[1].key = 'technology')))).toMatch(
      /categories repeat the key technology/,
    );
    expect(problems(variant((c) => (c.feeds[1].key = 'nasa-technology')))).toMatch(
      /feeds repeat the key nasa-technology/,
    );
  });

  it('refuses keys that are not lower-case hyphenated words', () => {
    expect(problems(variant((c) => (c.feeds[0].key = 'NASA Technology')))).toMatch(/feeds\.0\.key/);
  });

  it('refuses a feed whose category is not one of the categories', () => {
    expect(problems(variant((c) => (c.feeds[0].category = 'space')))).toMatch(
      /feeds\.0\.category is not one of the categories \(space\)/,
    );
  });

  it('refuses a mark that is not one or two letters and a colour that is not hex', () => {
    expect(problems(variant((c) => (c.feeds[0].mark = 'NTX')))).toMatch(/feeds\.0\.mark/);
    expect(problems(variant((c) => (c.feeds[0].color = 'blue')))).toMatch(/feeds\.0\.color/);
  });

  it('refuses an empty name or attribution, and a licence link that is not https', () => {
    expect(problems(variant((c) => (c.feeds[0].name = ' ')))).toMatch(/feeds\.0\.name/);
    expect(problems(variant((c) => (c.feeds[0].attribution = '')))).toMatch(
      /feeds\.0\.attribution/,
    );
    expect(
      problems(
        variant((c) => (c.feeds[0].license = { name: 'CC BY 4.0', url: 'http://example.com/by' })),
      ),
    ).toMatch(/feeds\.0\.license\.url must be an https URL/);
  });

  it('accepts a licence with a name and an https link', () => {
    const config = parseSharedConfig(
      variant(
        (c) =>
          (c.feeds[0].license = {
            name: 'CC BY 4.0',
            url: 'https://creativecommons.org/licenses/by/4.0/',
          }),
      ),
    );

    expect(config.feeds[0].license?.name).toBe('CC BY 4.0');
  });

  it('refuses fields it does not know', () => {
    expect(problems(variant((c) => Object.assign(c.feeds[0], { url: 'https://x.test' })))).toMatch(
      /feeds\.0/,
    );
  });
});
