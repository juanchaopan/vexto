// Clean article text from HTML (.docs/design/rules.md, 整理一篇文章). An original page goes
// through @mozilla/readability on jsdom, which finds the article and leaves out navigation, side
// bars, comments and the like; jsdom runs none of the page's scripts and loads nothing it links
// to. The article's HTML, or a feed entry's content, is then reduced to its headings and
// paragraphs as plain text: scripts, styles, forms, media, tables, figures, hidden elements and
// elements marked as ads, sharing or related links are left out.
//
// jsdom takes over a second to load, so it is loaded on the first use: a run with no feed due
// never pays for it.
import type { JSDOM } from 'jsdom';

export type ExtractedPage = { title: string | null; paragraphs: string[] };

/** Elements whose content is never article text. */
const LEFT_OUT = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'NAV',
  'ASIDE',
  'HEADER',
  'FOOTER',
  'FORM',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'MATH',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'PICTURE',
  'IMG',
  'FIGURE',
  'FIGCAPTION',
  'TABLE',
]);

/** Elements that start and end a paragraph of their own. */
const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'LI',
  'MAIN',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'UL',
]);

/** Words in a class or id that mark an element as something other than the article. */
const NOT_ARTICLE = new Set([
  'ad',
  'ads',
  'advert',
  'advertisement',
  'sponsor',
  'sponsored',
  'promo',
  'share',
  'sharing',
  'social',
  'comment',
  'comments',
  'related',
  'newsletter',
  'subscribe',
  'breadcrumb',
  'breadcrumbs',
]);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

async function loadTools() {
  const [jsdom, readability] = await Promise.all([import('jsdom'), import('@mozilla/readability')]);
  return {
    JSDOM: jsdom.JSDOM,
    VirtualConsole: jsdom.VirtualConsole,
    Readability: readability.Readability,
  };
}

let tools: ReturnType<typeof loadTools> | undefined;

function htmlTools() {
  return (tools ??= loadTools());
}

/** Hidden, or marked by its class or id as an ad, sharing, comments or the like. */
function isMarkedOut(element: Element): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
    return true;
  }
  const names = `${element.getAttribute('class') ?? ''} ${element.id}`.toLowerCase();
  return names.split(/[\s_-]+/).some((word) => NOT_ARTICLE.has(word));
}

function isLeftOut(element: Element): boolean {
  return LEFT_OUT.has(element.tagName.toUpperCase()) || isMarkedOut(element);
}

class ParagraphCollector {
  readonly paragraphs: string[] = [];
  private current = '';

  addText(text: string) {
    this.current += text;
  }

  endParagraph() {
    const text = this.current.replace(/\s+/g, ' ').trim();
    if (text) {
      this.paragraphs.push(text);
    }
    this.current = '';
  }
}

function collect(node: Node, collector: ParagraphCollector) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      collector.addText(child.textContent ?? '');
    } else if (child.nodeType === ELEMENT_NODE) {
      collectElement(child as Element, collector);
    }
  }
}

function collectElement(element: Element, collector: ParagraphCollector) {
  if (isLeftOut(element)) {
    return;
  }
  const tag = element.tagName.toUpperCase();
  if (tag === 'BR') {
    collector.endParagraph();
    return;
  }
  const block = BLOCKS.has(tag);
  if (block) {
    collector.endParagraph();
  }
  collect(element, collector);
  if (block) {
    collector.endParagraph();
  }
}

/** Parses the HTML with no scripts, no loading and no console output, and closes it after use. */
async function withDocument<T>(html: string, url: string | undefined, read: (dom: JSDOM) => T) {
  const { JSDOM: Dom, VirtualConsole } = await htmlTools();
  const dom = new Dom(html, { url, virtualConsole: new VirtualConsole() });
  try {
    return read(dom);
  } finally {
    dom.window.close();
  }
}

function paragraphsIn(body: Node): string[] {
  const collector = new ParagraphCollector();
  collect(body, collector);
  collector.endParagraph();
  return collector.paragraphs;
}

/** The headings and paragraphs of an HTML fragment, as plain text, in order. */
export function paragraphsOfHtml(html: string): Promise<string[]> {
  return withDocument(`<!doctype html><body>${html}`, undefined, (dom) =>
    paragraphsIn(dom.window.document.body),
  );
}

/** The text of a short piece of HTML, such as a title, on one line. */
export async function textOfHtml(html: string): Promise<string> {
  return (await paragraphsOfHtml(html)).join(' ');
}

/**
 * The article of a page, or null when Readability finds none. Elements marked as ads, sharing
 * and the like go before Readability reads the page, since it rewrites the elements it keeps and
 * their classes with them.
 */
export async function extractPage(html: string, url: string): Promise<ExtractedPage | null> {
  const { Readability } = await htmlTools();
  const article = await withDocument(html, url, (dom) => {
    const { document } = dom.window;
    for (const element of Array.from(document.body?.querySelectorAll('*') ?? [])) {
      if (element.isConnected && isMarkedOut(element)) {
        element.remove();
      }
    }
    return new Readability(document).parse();
  });
  if (!article?.content) {
    return null;
  }
  const title = article.title?.trim() ? article.title.trim() : null;
  return { title, paragraphs: await paragraphsOfHtml(article.content) };
}
