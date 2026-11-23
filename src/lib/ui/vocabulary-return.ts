// Coming back to the Vocabulary screen (.docs/design/screens.md, 列表的分批加载 and 顶栏). Closing
// card details or a review marks the next visit as a return: the list keeps its search, sort,
// loaded batches, selection and scroll position, and the focus goes back to what was opened.
// Any other way in, such as the top bar's Vocabulary button, starts the list over with no search,
// Word ascending and one batch, keeping only the tab and the round filters.

/** A return to the list, with the element the focus goes back to. */
export type VocabularyReturn = { focus: string | null };

let pending: VocabularyReturn | null = null;

/** Marks the next visit of the Vocabulary screen as a return; `focus` is a CSS selector. */
export function returnToVocabulary(focus: string | null = null): void {
  pending = { focus };
}

/** The return the next visit makes, without using it up. */
export function peekVocabularyReturn(): VocabularyReturn | null {
  return pending;
}

/** Uses the return up, so a later visit starts over. */
export function clearVocabularyReturn(): void {
  pending = null;
}
