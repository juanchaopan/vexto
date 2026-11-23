'use client';

// Deleting cards (.docs/design/screens.md, 删除词卡 and 错误的显示): one card from its Delete button
// or the chosen cards of selection mode, after the same confirmation. `Delete word?` or
// `Delete <N> words?` lists up to three lemmas, `+<more>` for the rest, and says the review
// progress goes too; the focus starts on Cancel.
//
// A deleted card leaves the list and the count, selection mode ends, `1 word deleted.` or
// `<N> words deleted.` shows, and the focus moves to the next card, or the one before without a
// next. A single card that was already gone counts as deleted, without a notice. When some chosen
// cards are gone, nothing is deleted: the dialog closes, they leave the list and the selection,
// and selection mode stays. Any other failure closes the dialog and keeps the selection, with
// Retry sending the same operation again when that can help.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { hasErrorCode, offersRetry } from '../../../lib/api/client.ts';
import { refreshReviewCounts } from '../../../lib/ui/review-counts.ts';
import { showToast } from '../../../lib/ui/toast.tsx';
import type { VocabularyQuery } from '../domain/vocabulary-query.ts';
import { DialogAction, ModalDialog } from './modal-dialog.tsx';
import {
  dropOtherLists,
  forgetCards,
  missingIdsOf,
  requestDelete,
  type CardListItem,
} from './vocabulary-api.ts';
import { setSelection, useVocabularyStore } from './vocabulary-store.ts';

const DELETE_FAILED = "Couldn't delete. Try again.";
const SELECTION_CHANGED = 'Some words changed. Check your selection.';
const NAMES_SHOWN = 3;

type Confirmation = { ids: string[]; names: string[]; operationId: string };

/**
 * The card the focus moves to once these are deleted: the first one left after the first deleted
 * card, else the last one left before it.
 */
function focusAfter(items: readonly CardListItem[], ids: readonly string[]): string | null {
  const gone = new Set(ids);
  const first = items.findIndex((item) => gone.has(item.id));
  if (first < 0) {
    return null;
  }
  const kept = (item: CardListItem) => !gone.has(item.id);
  const after = items.slice(first + 1).find(kept);
  const before = items.slice(0, first).reverse().find(kept);
  return (after ?? before)?.id ?? null;
}

function namesText(names: readonly string[], count: number): string {
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  return count > NAMES_SHOWN ? `${shown} +${count - NAMES_SHOWN}` : shown;
}

export type DeletionOptions = {
  /** The list on screen, which keeps its loaded batches. */
  query: VocabularyQuery;
  items: readonly CardListItem[];
  onDeleted: () => void;
};

export function useDeletion({ query, items, onDeleted }: DeletionOptions) {
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const focusTarget = useRef<string | null>(null);

  useEffect(() => {
    const target = focusTarget.current;
    const title = target
      ? document.querySelector<HTMLElement>(
          `[data-card-id="${CSS.escape(target)}"] [data-card-title]`,
        )
      : null;
    if (title) {
      focusTarget.current = null;
      title.focus();
    }
  });

  const deleted = (ids: string[], notify: boolean) => {
    focusTarget.current = focusAfter(items, ids);
    forgetCards(queryClient, ids);
    dropOtherLists(queryClient, query);
    refreshReviewCounts(queryClient);
    setSelection(false);
    onDeleted();
    if (notify) {
      showToast(ids.length === 1 ? '1 word deleted.' : `${ids.length} words deleted.`);
    }
  };

  const selectionChanged = (missing: string[]) => {
    forgetCards(queryClient, missing);
    const { selected } = useVocabularyStore.getState();
    setSelection(
      true,
      selected.filter((id) => !missing.includes(id)),
    );
    showToast(SELECTION_CHANGED);
  };

  const run = async (ids: string[], operationId: string) => {
    setBusy(true);
    try {
      await requestDelete(ids, operationId);
      deleted(ids, true);
    } catch (error) {
      if (ids.length === 1 && hasErrorCode(error, 'NOT_FOUND')) {
        deleted(ids, false);
      } else if (hasErrorCode(error, 'SELECTION_CHANGED')) {
        selectionChanged(missingIdsOf(error.details));
      } else {
        const retry = offersRetry(error) ? () => void run(ids, operationId) : undefined;
        showToast(DELETE_FAILED, { retry });
      }
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  };

  const confirm = (ids: readonly string[]) => {
    const lemmas = new Map(items.map((item) => [item.id, item.lemma]));
    setConfirmation({
      ids: [...ids],
      names: ids.flatMap((id) => lemmas.get(id) ?? []),
      operationId: crypto.randomUUID(),
    });
  };

  const dialog = confirmation ? (
    <ModalDialog
      title={
        confirmation.ids.length === 1 ? 'Delete word?' : `Delete ${confirmation.ids.length} words?`
      }
      onCancel={() => {
        if (!busy) {
          setConfirmation(null);
        }
      }}
      action={
        <DialogAction
          label="Delete"
          danger
          busy={busy}
          onClick={() => void run(confirmation.ids, confirmation.operationId)}
        />
      }
    >
      <p className="my-3 leading-[1.7]">
        {namesText(confirmation.names, confirmation.ids.length)}. Review progress will also be
        deleted.
      </p>
    </ModalDialog>
  ) : null;

  return { confirm, dialog };
}
