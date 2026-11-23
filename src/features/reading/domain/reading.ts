// Rules of the reader and its player (.docs/design/screens.md, 阅读页和播放器): the length shown in
// the article head, which sentence the audio is in, the queue of a continuous play, and where a
// tapped word or a dragged selection sits in the text a lookup explains.

export type SentenceTiming = { startMs: number; endMs: number };

export type ReadingSentence = { index: number; paragraphIndex: number; text: string };

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** Words in the sentences, as the article head counts them: letters and digits joined by ' ’ -. */
export function countWords(texts: readonly string[]): number {
  return texts.reduce((total, text) => total + (text.match(WORD)?.length ?? 0), 0);
}

/** Minutes of listening: the audio length rounded up, at least 1. */
export function listeningMinutes(durationMs: number): number {
  return Math.max(1, Math.ceil(durationMs / 60_000));
}

/**
 * The sentence playing at `ms`: the last one that has started. The pause after a sentence still
 * belongs to it, and a moment before the first sentence belongs to the first.
 */
export function sentenceAt(timings: readonly SentenceTiming[], ms: number): number {
  let low = 0;
  let high = timings.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timings[middle].startMs <= ms) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * The queue of a continuous play started from one article: that article and the ones after it in
 * the list's order. An article the list no longer holds plays alone.
 */
export function queueFrom(ids: readonly string[], startId: string): string[] {
  const start = ids.indexOf(startId);
  return start === -1 ? [startId] : ids.slice(start);
}

export type WordPiece =
  { kind: 'space'; text: string } | { kind: 'word'; text: string; start: number; end: number };

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]*([\s\S]*?)[^\p{L}\p{N}]*$/u;

/**
 * A sentence cut into the runs between spaces, each with the place of its word: the run without
 * the punctuation around it, so tapping `sticky.` looks up `sticky`. A run with no letter or
 * digit is drawn as it is and looks up nothing.
 */
export function wordPieces(text: string): WordPiece[] {
  const pieces: WordPiece[] = [];
  let offset = 0;
  for (const run of text.split(/(\s+)/)) {
    if (run !== '') {
      const core = EDGE_PUNCTUATION.exec(run)?.[1] ?? '';
      if (/^\s+$/.test(run) || core === '') {
        pieces.push({ kind: 'space', text: run });
      } else {
        const start = offset + run.indexOf(core);
        pieces.push({ kind: 'word', text: run, start, end: start + core.length });
      }
    }
    offset += run.length;
  }
  return pieces;
}

/**
 * The text of the sentences from `first` to `last` as the body holds it: one space between
 * sentences of a paragraph and two line feeds between paragraphs. `starts` are the places where
 * each of the sentences begins in that text.
 */
export function sentenceContext(
  sentences: readonly ReadingSentence[],
  first: number,
  last: number,
): { text: string; starts: number[] } {
  let text = '';
  const starts: number[] = [];
  for (let index = first; index <= last; index += 1) {
    if (index > first) {
      text +=
        sentences[index].paragraphIndex === sentences[index - 1].paragraphIndex ? ' ' : '\n\n';
    }
    starts.push(text.length);
    text += sentences[index].text;
  }
  return { text, starts };
}

export type SentencePoint = { sentence: number; offset: number };

export type ArticleSelection = {
  firstSentence: number;
  lastSentence: number;
  /** The selection's place in the text of the sentences from first to last. */
  start: number;
  end: number;
  text: string;
};

function before(a: SentencePoint, b: SentencePoint) {
  return a.sentence < b.sentence || (a.sentence === b.sentence && a.offset <= b.offset);
}

function lastStartAtOrBefore(starts: readonly number[], position: number) {
  let found = 0;
  starts.forEach((start, index) => {
    if (start <= position) {
      found = index;
    }
  });
  return found;
}

/**
 * The selection between two points of the article, in either order, without the spaces at its
 * ends; null when it holds no text. The context is the sentences the trimmed selection touches,
 * and the selection's place is counted in that context's text.
 */
export function articleSelection(
  sentences: readonly ReadingSentence[],
  anchor: SentencePoint,
  focus: SentencePoint,
): ArticleSelection | null {
  const [from, to] = before(anchor, focus) ? [anchor, focus] : [focus, anchor];
  const span = sentenceContext(sentences, from.sentence, to.sentence);
  let start = span.starts[0] + from.offset;
  let end = span.starts[to.sentence - from.sentence] + to.offset;
  while (start < end && /\s/.test(span.text[start])) {
    start += 1;
  }
  while (end > start && /\s/.test(span.text[end - 1])) {
    end -= 1;
  }
  if (start === end) {
    return null;
  }
  const first = lastStartAtOrBefore(span.starts, start);
  const last = lastStartAtOrBefore(span.starts, end - 1);
  const shift = span.starts[first];
  return {
    firstSentence: from.sentence + first,
    lastSentence: from.sentence + last,
    start: start - shift,
    end: end - shift,
    text: span.text.slice(start, end),
  };
}
