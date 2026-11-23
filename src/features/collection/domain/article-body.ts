// The normalized body of an article and its sentences (.docs/design/rules.md, 整理一篇文章 and
// data.md, articles and article_sentences). Paragraphs come in as plain text; inside each, runs
// of white space become one space. The body is the sentences of each paragraph joined by one
// space, and the paragraphs joined by two line feeds. Every sentence records where it lies in the
// body, as a UTF-16 range [start, end), and which paragraph it belongs to.

export type BodySentence = {
  text: string;
  paragraphIndex: number;
  bodyStart: number;
  bodyEnd: number;
};

export type ArticleBody = {
  text: string;
  sentences: BodySentence[];
  wordCount: number;
};

export type WordLimits = { min: number; max: number };

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' });

/** Characters that take no room: soft hyphens, zero-width spaces and joiners, byte order marks. */
const INVISIBLE = /­|​|‌|‍|⁠|﻿/g;
const CONTROL = /\p{Cc}/gu;
const HAS_CONTENT = /[\p{L}\p{N}]/u;

/** A paragraph's text in NFC with every run of white space as one space and nothing at its ends. */
export function normalizeParagraph(text: string): string {
  return text
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The number of words, as the English word segmentation counts them. */
export function countWords(text: string): number {
  let count = 0;
  for (const segment of wordSegmenter.segment(text)) {
    if (segment.isWordLike) {
      count += 1;
    }
  }
  return count;
}

export function withinWordLimits(wordCount: number, limits: WordLimits): boolean {
  return wordCount >= limits.min && wordCount <= limits.max;
}

/**
 * The paragraph's sentences. A piece with no letter or digit, such as a lone dash, is not read
 * as a sentence of its own: it stays with the sentence before it.
 */
function sentencesOf(paragraph: string): string[] {
  const sentences: string[] = [];
  for (const { segment } of sentenceSegmenter.segment(paragraph)) {
    const sentence = segment.trim();
    if (!sentence) {
      continue;
    }
    if (!HAS_CONTENT.test(sentence) && sentences.length > 0) {
      sentences[sentences.length - 1] += ` ${sentence}`;
    } else {
      sentences.push(sentence);
    }
  }
  return sentences;
}

/**
 * The paragraphs without a first one that only repeats the title, as extracted pages and feed
 * content often start with the headline.
 */
export function withoutTitleParagraph(paragraphs: readonly string[], title: string): string[] {
  const [first, ...rest] = paragraphs;
  const same = (text: string) => normalizeParagraph(text).toLowerCase();
  return first !== undefined && same(first) === same(title) ? rest : [...paragraphs];
}

/** Builds the body from plain-text paragraphs; paragraphs without letters or digits are dropped. */
export function buildArticleBody(paragraphs: readonly string[]): ArticleBody {
  const sentences: BodySentence[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (const paragraph of paragraphs.map(normalizeParagraph)) {
    const own = HAS_CONTENT.test(paragraph) ? sentencesOf(paragraph) : [];
    if (own.length === 0) {
      continue;
    }
    if (parts.length > 0) {
      offset += 2;
    }
    const paragraphIndex = parts.length;
    own.forEach((text, index) => {
      const bodyStart = offset + (index > 0 ? 1 : 0);
      sentences.push({ text, paragraphIndex, bodyStart, bodyEnd: bodyStart + text.length });
      offset = bodyStart + text.length;
    });
    parts.push(own.join(' '));
  }
  const text = parts.join('\n\n');
  return { text, sentences, wordCount: countWords(text) };
}
