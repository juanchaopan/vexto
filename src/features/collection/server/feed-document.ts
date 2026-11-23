// Reads an RSS 2.0, RSS 1.0 (RDF) or Atom document with fast-xml-parser into its entries, in the
// feed's order (.docs/design/rules.md, 整理一篇文章). Only what the pipeline uses is taken: the
// link, title, author, published time as written, and the HTML content. The document is data
// only; nothing in it is followed or run, and entity expansion stays within the parser's limits.
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type FeedItem = {
  /** The entry's link as written, possibly relative to the feed. */
  link: string | null;
  /** The title as written; it may hold HTML. */
  title: string | null;
  author: string | null;
  /** The published time as written. */
  published: string | null;
  /** The entry's body as HTML: the full content when the feed has it, else its summary. */
  content: string | null;
};

/** The document is not XML, or not one of the feed formats. */
export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedParseError';
  }
}

const LISTS = new Set(['item', 'entry', 'link', 'author', 'dc:creator', 'category']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => LISTS.has(name),
});

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text of an element: plain text, the text beside its attributes, or its first item's. */
function textOf(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map(textOf).find((text) => text !== null) ?? null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    return text === '' ? null : text;
  }
  return isNode(value) ? textOf(value['#text']) : null;
}

function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined ? [] : [value];
}

function firstText(item: Node, names: readonly string[]): string | null {
  for (const name of names) {
    const text = textOf(item[name]);
    if (text !== null) {
      return text;
    }
  }
  return null;
}

/** An RSS link is the element's text; an Atom link is the href of the alternate link. */
function linkOf(item: Node): string | null {
  for (const link of listOf(item.link)) {
    if (!isNode(link)) {
      const text = textOf(link);
      if (text !== null) {
        return text;
      }
      continue;
    }
    const rel = textOf(link['@_rel']) ?? 'alternate';
    const href = textOf(link['@_href']) ?? textOf(link);
    if (rel === 'alternate' && href !== null) {
      return href;
    }
  }
  return null;
}

/** The authors' names joined, from dc:creator, Atom's author name or RSS's author. */
function authorOf(item: Node): string | null {
  const names = [...listOf(item['dc:creator']), ...listOf(item.author)]
    .map((author) => (isNode(author) && 'name' in author ? textOf(author.name) : textOf(author)))
    .filter((name): name is string => name !== null);
  return names.length > 0 ? [...new Set(names)].join(', ') : null;
}

function rssItem(item: Node): FeedItem {
  return {
    link: linkOf(item) ?? permalinkOf(item),
    title: textOf(item.title),
    author: authorOf(item),
    published: firstText(item, ['pubDate', 'dc:date']),
    content: firstText(item, ['content:encoded', 'description']),
  };
}

/** An RSS guid is the entry's address unless it says it is not a permalink. */
function permalinkOf(item: Node): string | null {
  const guid = item.guid;
  if (isNode(guid) && textOf(guid['@_isPermaLink']) === 'false') {
    return null;
  }
  const text = textOf(guid);
  return text !== null && /^https?:\/\//i.test(text) ? text : null;
}

/** Atom content that is HTML or text; XHTML content is markup the parser has taken apart. */
function atomContent(value: unknown): string | null {
  const type = isNode(value) ? textOf(value['@_type']) : null;
  return type === 'xhtml' ? null : textOf(value);
}

function atomEntry(entry: Node): FeedItem {
  return {
    link: linkOf(entry),
    title: textOf(entry.title),
    author: authorOf(entry),
    published: firstText(entry, ['published', 'updated']),
    content: atomContent(entry.content) ?? atomContent(entry.summary),
  };
}

function entriesOf(document: Node): FeedItem[] {
  const rss = document.rss;
  if (isNode(rss)) {
    const channel = rss.channel;
    return listOf(isNode(channel) ? channel.item : undefined)
      .filter(isNode)
      .map(rssItem);
  }
  const rdf = document['rdf:RDF'];
  if (isNode(rdf)) {
    return listOf(rdf.item).filter(isNode).map(rssItem);
  }
  const feed = document.feed;
  if (isNode(feed)) {
    return listOf(feed.entry).filter(isNode).map(atomEntry);
  }
  throw new FeedParseError('The document is not an RSS or Atom feed.');
}

/** The entries of a feed document; throws a FeedParseError when it is not one. */
export function parseFeedDocument(xml: string): FeedItem[] {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new FeedParseError(`The feed is not well-formed XML: ${valid.err.msg}`);
  }
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new FeedParseError(`The feed could not be parsed: ${(error as Error).message}`);
  }
  if (!isNode(document)) {
    throw new FeedParseError('The document is not an RSS or Atom feed.');
  }
  return entriesOf(document);
}
