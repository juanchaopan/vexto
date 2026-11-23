import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FeedParseError, parseFeedDocument } from './feed-document.ts';

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('parseFeedDocument', () => {
  it('reads RSS 2.0 items in the feed order', () => {
    expect(parseFeedDocument(fixture('rss-feed.xml'))).toEqual([
      {
        link: 'https://lab.example.org/notes/clouds/?utm_source=rss',
        title: 'Clouds & Climate: A Quiet Experiment',
        author: 'Ada Example',
        published: 'Thu, 05 Nov 2026 14:30:00 +0000',
        content:
          '<p>The lab grew small clouds in a glass chamber.</p><p>They watched how <em>droplets</em> formed.</p>',
      },
      {
        link: 'https://lab.example.org/notes/guid-only',
        title: 'Notes Without a Link',
        author: null,
        published: '11/05/2026 - 12:00',
        content: '<p>An entry whose address is its guid.</p>',
      },
      {
        link: null,
        title: 'An Entry Nobody Can Open',
        author: null,
        published: null,
        content: 'No link and no permalink.',
      },
    ]);
  });

  it('reads Atom entries with their alternate link, authors and HTML content', () => {
    expect(parseFeedDocument(fixture('atom-feed.xml'))).toEqual([
      {
        link: '/entries/orchard',
        title: 'Mapping the <i>Old</i> Orchard',
        author: 'Ben Example, Cleo Example',
        published: '2026-11-06T08:15:00-05:00',
        content: '<p>Volunteers counted every tree in the orchard.</p>',
      },
      {
        link: 'https://journal.example.org/entries/summary',
        title: 'Only a Summary',
        author: null,
        published: '2026-11-04T12:00:00Z',
        content: 'This entry has only a summary.',
      },
    ]);
  });

  it('reads RSS 1.0 items', () => {
    const rdf = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"
        xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel rdf:about="https://old.example.org/"><title>Old</title></channel>
        <item rdf:about="https://old.example.org/1">
          <title>First</title><link>https://old.example.org/1</link>
          <dc:date>2026-11-01T10:00:00Z</dc:date><description>Text.</description>
        </item>
      </rdf:RDF>`;

    expect(parseFeedDocument(rdf)).toEqual([
      {
        link: 'https://old.example.org/1',
        title: 'First',
        author: null,
        published: '2026-11-01T10:00:00Z',
        content: 'Text.',
      },
    ]);
  });

  it('gives no entries for an empty channel', () => {
    expect(
      parseFeedDocument('<rss version="2.0"><channel><title>T</title></channel></rss>'),
    ).toEqual([]);
  });

  it('does not expand nested entities into a huge text', () => {
    const entities = `<!DOCTYPE rss [
      <!ENTITY a "aaaaaaaaaa">
      <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
      <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
    ]>`;
    const xml = `<?xml version="1.0"?>${entities}<rss><channel><item><title>&c;&c;&c;</title>
      <link>https://e.example.org/x</link></item></channel></rss>`;

    const parse = () => parseFeedDocument(xml);
    let title: string | null = null;
    try {
      title = parse()[0]?.title ?? null;
    } catch (error) {
      expect(error).toBeInstanceOf(FeedParseError);
    }
    expect((title ?? '').length).toBeLessThan(1000);
  });

  it.each([
    ['an HTML page', '<!doctype html><html><body><p>Not a feed</p></body></html>'],
    ['broken XML', '<rss><channel><item></channel>'],
    ['another XML document', '<?xml version="1.0"?><svg><g/></svg>'],
    ['text', 'just some text'],
  ])('refuses %s', (_name, text) => {
    expect(() => parseFeedDocument(text)).toThrow(FeedParseError);
  });
});
