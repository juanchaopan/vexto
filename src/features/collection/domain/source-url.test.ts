import { describe, expect, it } from 'vitest';
import { absoluteLink, normalizeSourceUrl } from './source-url.ts';

describe('absoluteLink', () => {
  it('resolves a link against the feed address', () => {
    expect(absoluteLink('/news/item-1', 'https://feeds.example.org/rss.xml')).toBe(
      'https://feeds.example.org/news/item-1',
    );
    expect(absoluteLink(' https://other.example.org/a ', 'https://feeds.example.org/')).toBe(
      'https://other.example.org/a',
    );
  });

  it('refuses links that are not web addresses', () => {
    expect(absoluteLink('mailto:someone@example.org', 'https://feeds.example.org/')).toBeNull();
    expect(absoluteLink('javascript:alert(1)', 'https://feeds.example.org/')).toBeNull();
    expect(absoluteLink('http://[bad', 'https://feeds.example.org/')).toBeNull();
  });
});

describe('normalizeSourceUrl', () => {
  it('lower-cases the host and drops the fragment, tracking parameters and trailing slashes', () => {
    expect(
      normalizeSourceUrl(
        'https://News.Example.ORG/stories/one/?utm_source=rss&id=7&UTM_Medium=x&fbclid=abc#top',
      ),
    ).toBe('https://news.example.org/stories/one?id=7');
  });

  it('gives the same form for addresses that differ only in those parts', () => {
    const forms = [
      'https://news.example.org/a/',
      'https://NEWS.example.org/a',
      'https://news.example.org/a#comments',
      'https://news.example.org/a?utm_campaign=feed',
      'https://news.example.org:443/a',
    ].map(normalizeSourceUrl);

    expect(new Set(forms)).toEqual(new Set(['https://news.example.org/a']));
  });

  it('keeps the path and the other parameters in their order', () => {
    expect(normalizeSourceUrl('https://example.org/')).toBe('https://example.org');
    expect(normalizeSourceUrl('http://example.org/p?b=2&a=1')).toBe('http://example.org/p?b=2&a=1');
  });

  it('is null for an address that is not http(s)', () => {
    expect(normalizeSourceUrl('ftp://example.org/file')).toBeNull();
    expect(normalizeSourceUrl('not a url')).toBeNull();
  });
});
