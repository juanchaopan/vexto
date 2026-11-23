// The examples of a Spell question with the target hidden (.docs/design/rules.md, Spell, and
// .docs/design/interfaces.md, 下一题). The server cuts each example into the text around the
// target words and a gap for each, every text part with its place in the whole example; the words
// themselves are never sent. The browser shows the parts with a blank line for each gap, and
// works out from the parts where the gaps lie, so a lookup can be made on either side of a blank
// but never across one.

/** A range of an example's text, UTF-16 offsets, end exclusive. */
export type TextRange = readonly [start: number, end: number];

/** A part of a Spell example: shown text at its place in the whole example, or a hidden word. */
export type ClozeSegment = { start: number; text: string } | { gap: true };

export type ShownSegment = Extract<ClozeSegment, { text: string }>;

/** The ranges in order, with ranges that overlap or touch made one. */
export function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** The example cut into its shown text and a gap for each hidden range. */
export function clozeSegments(text: string, hidden: readonly TextRange[]): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  let at = 0;
  for (const [start, end] of mergeRanges(hidden)) {
    if (start > at) {
      segments.push({ start: at, text: text.slice(at, start) });
    }
    segments.push({ gap: true });
    at = Math.max(at, end);
  }
  if (at < text.length) {
    segments.push({ start: at, text: text.slice(at) });
  }
  return segments;
}

export function isShown(segment: ClozeSegment): segment is ShownSegment {
  return 'text' in segment;
}

/**
 * Where the gaps lie in the whole example: from the end of the text before each to the start of
 * the text after it. A gap at the very end takes one character, as nothing after it tells more.
 */
export function gapRanges(segments: readonly ClozeSegment[]): TextRange[] {
  const ranges: TextRange[] = [];
  let at = 0;
  segments.forEach((segment, index) => {
    if (isShown(segment)) {
      at = segment.start + segment.text.length;
      return;
    }
    const next = segments.slice(index + 1).find(isShown);
    ranges.push([at, next ? next.start : at + 1]);
  });
  return ranges;
}

/** The example as the browser can rebuild it: the shown text in place, the gaps as spaces. */
export function standInText(segments: readonly ClozeSegment[]): string {
  let text = '';
  for (const segment of segments) {
    if (isShown(segment)) {
      text = text.padEnd(segment.start, ' ') + segment.text;
    }
  }
  const end = gapRanges(segments).reduce((last, [, gapEnd]) => Math.max(last, gapEnd), 0);
  return text.padEnd(end, ' ');
}

/** Whether a range of the example touches a hidden word. */
export function touchesGap(segments: readonly ClozeSegment[], range: TextRange): boolean {
  return gapRanges(segments).some(([start, end]) => range[0] < end && start < range[1]);
}
