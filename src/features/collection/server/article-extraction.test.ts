import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  extractPage,
  paragraphsOfHtml,
  textOfHtml,
  type ExtractedPage,
} from './article-extraction.ts';

const page = readFileSync(new URL('./fixtures/article-page.html', import.meta.url), 'utf8');

describe('extractPage', () => {
  let extracted: ExtractedPage | null;

  beforeAll(async () => {
    extracted = await extractPage(page, 'https://news.example.org/stories/river-sensors');
  });

  it('finds the article and keeps its headings and paragraphs in order', () => {
    expect(extracted?.paragraphs).toHaveLength(6);
    expect(extracted?.paragraphs[0]).toMatch(/^A small team of field engineers spent the autumn/);
    expect(extracted?.paragraphs[2]).toBe('Teaching the software');
    expect(extracted?.paragraphs[5]).toMatch(/text message service that anyone can join\.$/);
  });

  it('leaves out navigation, ads, figures, sharing, related links, comments and scripts', () => {
    const text = extracted?.paragraphs.join('\n') ?? '';

    for (const left of [
      'About us',
      'Advertisement',
      'A sensor floats',
      'Share this story',
      'Related stories',
      'reader comment',
      'Copyright',
      'replaced by a script',
      'window.injected',
    ]) {
      expect(text).not.toContain(left);
    }
  });

  it('runs none of the page scripts, so the title is the one the page was served with', () => {
    expect(extracted?.title).toBe('River Sensors Learn to Listen');
  });

  it('puts every paragraph on one line', () => {
    for (const paragraph of extracted?.paragraphs ?? []) {
      expect(paragraph).not.toMatch(/\s{2,}|\n/);
    }
  });

  it('finds no article in a page without one', async () => {
    expect(await extractPage('<html><body></body></html>', 'https://news.example.org/')).toBeNull();
  });
});

describe('paragraphsOfHtml', () => {
  it('splits block elements and line breaks into paragraphs and joins inline text', async () => {
    const html = `<p>One <b>bold</b> line.</p>Loose text<br>after a break<ul><li>An item</li></ul>
      <script>alert(1)</script><table><tr><td>cell</td></tr></table>
      <div hidden>Hidden</div><span aria-hidden="true">Decor</span><h3>Heading</h3>`;

    expect(await paragraphsOfHtml(html)).toEqual([
      'One bold line.',
      'Loose text',
      'after a break',
      'An item',
      'Heading',
    ]);
  });

  it('leaves out elements whose class or id marks them as ads, sharing or comments', async () => {
    const html = `<p>Kept.</p><div class="ad-slot">Buy</div><div id="user_comments">Mine</div>
      <p class="social-share">Tweet</p><p class="header-adjacent">Kept too.</p>`;

    expect(await paragraphsOfHtml(html)).toEqual(['Kept.', 'Kept too.']);
  });

  it('decodes character references', async () => {
    expect(await paragraphsOfHtml('<p>Fish &amp; chips&nbsp;&mdash; &#169; 2026</p>')).toEqual([
      'Fish & chips — © 2026',
    ]);
  });
});

describe('textOfHtml', () => {
  it('gives the text of a title that holds markup', async () => {
    expect(await textOfHtml('Mapping the <i>Old</i>\n Orchard')).toBe('Mapping the Old Orchard');
    expect(await textOfHtml('Clouds & Climate')).toBe('Clouds & Climate');
  });
});
