// The words a Spell question hides in a card's example (.docs/design/rules.md, Spell and 选区和
// 上下文): the stored target ranges, and every place an accepted form of the card stands as a whole
// word, also where the stored ranges missed it. The question cuts these words out, and a lookup
// in the question's example refuses a selection that overlaps one, so both read them from here.
import { findTargetRanges } from './explanation.ts';
import type { TargetRange } from './lookup-entry.ts';

/** The ranges a Spell question hides in the example, in order; they may overlap. */
export function spellHiddenRanges(
  text: string,
  targetRanges: readonly TargetRange[],
  acceptedForms: readonly string[],
): TargetRange[] {
  return [...targetRanges, ...findTargetRanges(text, acceptedForms)].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
}
