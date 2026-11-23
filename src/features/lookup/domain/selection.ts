// What a lookup explains (.docs/design/rules.md, 选区和上下文): a word or a run of words of its
// context, at most 8 words or 80 characters. A selection always covers whole words: one that
// starts or ends inside a word grows to the word's edges, and the spaces and punctuation at its
// ends are left out, so a tapped `sticky.` and a dragged ` sticky. ` both explain `sticky`. The
// client and the server apply the same rules, so the server answers exactly what the person saw.
//
// The cache of a lookup is keyed by the context with its spacing normalized: every run of white
// space is one space, so a line break between paragraphs and a space between sentences read the
// same (视觉换行不进键). The selection is moved into the normalized text with the context.

export const SELECTION_MAX_WORDS = 8;
export const SELECTION_MAX_CHARACTERS = 80;

/** A UTF-16 range of a text, end exclusive. */
export type TextRange = { start: number; end: number };

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
const SPACE = /^\s$/u;

function isLetterOrDigit(text: string, index: number): boolean {
  return index >= 0 && index < text.length && LETTER_OR_DIGIT.test(text[index]);
}

/** Whether the range lies inside the text, as whole UTF-16 positions with something in it. */
export function isRangeOf(text: string, range: TextRange): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.start < range.end &&
    range.end <= text.length
  );
}

/**
 * The selection grown to whole words and without the spaces and punctuation at its ends, or null
 * when it holds no letter or digit. The range must be one of the text (see isRangeOf).
 */
export function selectionExtent(text: string, range: TextRange): TextRange | null {
  let { start, end } = range;
  while (isLetterOrDigit(text, start - 1) && isLetterOrDigit(text, start)) {
    start -= 1;
  }
  while (isLetterOrDigit(text, end - 1) && isLetterOrDigit(text, end)) {
    end += 1;
  }
  while (start < end && !isLetterOrDigit(text, start)) {
    start += 1;
  }
  while (end > start && !isLetterOrDigit(text, end - 1)) {
    end -= 1;
  }
  return start === end ? null : { start, end };
}

/** Words of a text: letters and digits, joined by an apostrophe or a hyphen inside a word. */
export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** Why a selected text cannot be looked up, or null when it can. */
export function selectionProblem(text: string): 'empty' | 'too-long' | null {
  const words = countWords(text);
  if (words === 0) {
    return 'empty';
  }
  return words > SELECTION_MAX_WORDS || [...text].length > SELECTION_MAX_CHARACTERS
    ? 'too-long'
    : null;
}

/** Whether the range overlaps any of the ranges, such as the hidden word of a Spell question. */
export function overlapsAny(
  range: TextRange,
  ranges: readonly (readonly [start: number, end: number])[],
): boolean {
  return ranges.some(([start, end]) => range.start < end && start < range.end);
}

/**
 * The context with every run of white space made one space and none at its ends, and the range
 * moved into it. The range's ends must be next to letters or digits, as a selection's extent is.
 */
export function normalizeContext(
  text: string,
  range: TextRange,
): { text: string; range: TextRange } {
  const places: number[] = new Array<number>(text.length + 1);
  let normalized = '';
  let index = 0;
  while (index < text.length) {
    if (SPACE.test(text[index])) {
      let next = index;
      while (next < text.length && SPACE.test(text[next])) {
        places[next] = normalized.length;
        next += 1;
      }
      if (normalized !== '' && next < text.length) {
        normalized += ' ';
      }
      index = next;
    } else {
      places[index] = normalized.length;
      normalized += text[index];
      index += 1;
    }
  }
  places[text.length] = normalized.length;
  return { text: normalized, range: { start: places[range.start], end: places[range.end] } };
}

export type SelectableWord = TextRange & { text: string };

/** The words of a text a person can choose from, in order, each with its range. */
export function selectableWords(text: string): SelectableWord[] {
  return [...text.matchAll(WORD)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}
