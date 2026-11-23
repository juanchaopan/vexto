// How saving an explanation decides what to do (.docs/design/rules.md, 保存 and 删除). A lookup
// already saved as a card is that card. Otherwise the member's cards with the same lemma and part
// of speech are the candidates: the AI says which of them, if any, has the same meaning, and that
// card is the duplicate; with none the explanation becomes a new card. The writes check that the
// candidates are still the ones the decision was made on, down to their last change.

/** A card as the decision saw it: its ID and when it last changed. */
export type CardStamp = { id: string; updatedAt: string };

export type SaveDecision = { kind: 'duplicate'; cardId: string } | { kind: 'create' };

/** Whether two readings of the candidates show the same cards, unchanged, in any order. */
export function sameCards(before: readonly CardStamp[], after: readonly CardStamp[]): boolean {
  if (before.length !== after.length) {
    return false;
  }
  const stamps = new Map(before.map((card) => [card.id, card.updatedAt]));
  return after.every((card) => stamps.get(card.id) === card.updatedAt);
}

/**
 * The decision from the AI's answer: the number of the candidate with the same meaning, counted
 * from 1 in the order the candidates were sent, or 0 for none of them.
 */
export function decisionOf(candidates: readonly CardStamp[], sameMeaning: number): SaveDecision {
  const card = sameMeaning > 0 ? candidates[sameMeaning - 1] : undefined;
  return card ? { kind: 'duplicate', cardId: card.id } : { kind: 'create' };
}

/** A batch delete takes this many cards at most, and a selection holds no more. */
export const SELECTION_MAX = 100;

/** The requested IDs that are not among the ones found, in the order they were requested. */
export function missingIds(requested: readonly string[], found: readonly string[]): string[] {
  const present = new Set(found);
  return requested.filter((id) => !present.has(id));
}

/**
 * The selection with the IDs added or taken away, or null when adding would take it over the
 * limit; IDs already chosen are not counted twice.
 */
export function changedSelection(
  selected: readonly string[],
  ids: readonly string[],
  add: boolean,
): string[] | null {
  if (!add) {
    const removed = new Set(ids);
    return selected.filter((id) => !removed.has(id));
  }
  const next = [...new Set([...selected, ...ids])];
  return next.length > SELECTION_MAX ? null : next;
}
