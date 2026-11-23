'use client';

// Saving an explanation to the vocabulary (.docs/design/screens.md, 保存到生词本, screens 28–29
// and 58–59). The host provides the saver the explanation's Add word button calls:
//   - saved: `Saved to Vocabulary.`, and the explanation shows the check;
//   - a card of the same meaning exists: the replace question, `Replace saved word?` with the
//     lemma and part of speech, the saved and the new meaning and examples side by side, and
//     `Review progress stays the same.`; Replace puts the new ones on the saved card and says
//     `Saved word replaced. Review progress is unchanged.`, Cancel leaves everything as it was;
//   - the card changed or went meanwhile: `This word changed on another device.`, and the lists
//     are read again;
//   - another failure: `Couldn't save the word.` or `Couldn't replace the word.`, with Retry
//     sending the same operation again when that can help. A failed replacement keeps the dialog
//     open, and its notice is drawn above the dialog's backdrop.
// Every change asks for the review counts again and drops the loaded Vocabulary lists.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { hasErrorCode, offersRetry } from '../../../lib/api/client.ts';
import {
  announceSavedWord,
  provideWordSaver,
  type SavableLookup,
} from '../../../lib/ui/lookup-bridge.ts';
import { refreshReviewCounts } from '../../../lib/ui/review-counts.ts';
import { onSignOut } from '../../../lib/ui/sign-out-cleanup.ts';
import { showToast } from '../../../lib/ui/toast.tsx';
import { DialogAction, ModalDialog } from './modal-dialog.tsx';
import {
  cardKey,
  dropOtherLists,
  requestReplace,
  requestSave,
  savedCardOf,
  type SavedCard,
} from './vocabulary-api.ts';

const SAVED = 'Saved to Vocabulary.';
const SAVE_FAILED = "Couldn't save the word.";
const REPLACED = 'Saved word replaced. Review progress is unchanged.';
const REPLACE_FAILED = "Couldn't replace the word.";
const CHANGED = 'This word changed on another device.';

/** The replace question: the explanation, the saved card and how the question ends. */
type ReplaceQuestion = {
  lookup: SavableLookup;
  saved: SavedCard;
  operationId: string;
  done: (cardId: string | null) => void;
};

function vocabularyChanged(queryClient: QueryClient, cardId?: string) {
  dropOtherLists(queryClient);
  refreshReviewCounts(queryClient);
  if (cardId) {
    queryClient.removeQueries({ queryKey: cardKey(cardId) });
  }
}

type ColumnProps = {
  title: string;
  meaningZh: string;
  examples: readonly { id: string; text: string }[];
  fresh?: boolean;
};

function Column({ title, meaningZh, examples, fresh = false }: ColumnProps) {
  return (
    <section
      aria-label={title}
      className={`min-w-0 rounded-[5px] border p-[9px] ${
        fresh
          ? 'border-[color-mix(in_srgb,var(--color-accent),var(--color-line)_50%)] bg-soft'
          : 'border-line bg-page'
      }`}
    >
      <h3 className="mb-1.5 text-[11px] font-medium text-muted">{title}</h3>
      <p className="mb-2 text-[13px]">{meaningZh}</p>
      <ol className="grid list-decimal gap-1.5 pl-4 text-xs leading-normal">
        {examples.map((example) => (
          <li key={example.id}>{example.text}</li>
        ))}
      </ol>
    </section>
  );
}

function ReplaceDialog({ question }: { question: ReplaceQuestion }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { lookup, saved, operationId, done } = question;

  const replace = async () => {
    setBusy(true);
    try {
      const card = await requestReplace(saved, lookup.id, operationId);
      vocabularyChanged(queryClient, card.id);
      announceSavedWord(lookup.id, card.id);
      showToast(REPLACED);
      done(card.id);
    } catch (error) {
      if (hasErrorCode(error, 'NOT_FOUND', 'CONFLICT')) {
        vocabularyChanged(queryClient, saved.id);
        showToast(CHANGED);
        done(null);
      } else {
        showToast(REPLACE_FAILED, offersRetry(error) ? { retry: () => void replace() } : {});
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title="Replace saved word?"
      onCancel={() => {
        if (!busy) {
          done(null);
        }
      }}
      action={<DialogAction label="Replace" busy={busy} onClick={() => void replace()} />}
    >
      <p className="mt-1.5 text-muted">
        {saved.lemma} · {saved.pos}
      </p>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
        <Column title="Saved" meaningZh={saved.meaningZh} examples={saved.examples} />
        <Column title="New" meaningZh={lookup.meaningZh} examples={lookup.examples} fresh />
      </div>
      <p className="my-3 leading-[1.7]">Review progress stays the same.</p>
    </ModalDialog>
  );
}

/** Provides the saver of explanations while mounted, and shows its replace question. */
export function WordSaverHost() {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState<ReplaceQuestion | null>(null);

  useEffect(() => {
    const ask = (lookup: SavableLookup, saved: SavedCard) =>
      new Promise<string | null>((resolve) => {
        setQuestion({
          lookup,
          saved,
          operationId: crypto.randomUUID(),
          done: (cardId) => {
            setQuestion(null);
            resolve(cardId);
          },
        });
      });

    const save = async (lookup: SavableLookup, operationId: string): Promise<string | null> => {
      try {
        const card = await requestSave(lookup.id, operationId);
        vocabularyChanged(queryClient);
        announceSavedWord(lookup.id, card.id);
        showToast(SAVED);
        return card.id;
      } catch (error) {
        const saved = hasErrorCode(error, 'DUPLICATE_WORD')
          ? savedCardOf(error.details)
          : undefined;
        if (saved) {
          return ask(lookup, saved);
        }
        if (hasErrorCode(error, 'CONFLICT')) {
          vocabularyChanged(queryClient);
          showToast(CHANGED);
          return null;
        }
        const retry = offersRetry(error) ? () => void save(lookup, operationId) : undefined;
        showToast(SAVE_FAILED, { retry });
        return null;
      }
    };

    return provideWordSaver((lookup) => save(lookup, crypto.randomUUID()));
  }, [queryClient]);

  useEffect(() => onSignOut(() => setQuestion(null)), []);

  return question ? <ReplaceDialog key={question.operationId} question={question} /> : null;
}
