'use client';

// The Vocabulary screen (.docs/design/screens.md, Vocabulary, screens 30–41, 60 and 65–68): the
// title and the selection mode button; the Speak, Spell and Translate buttons with their counts,
// the only way into a review; the tabs, the search and the count; the round filters and the sort;
// and the cards in batches of 20. Changing the tab, a filter, the sort or the search starts again
// from the first batch. Coming back from card details or a review restores the list; any other
// way in starts it over with no search, Word ascending and one batch, the tab and the round
// filters kept.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { offersRetry } from '../../../lib/api/client.ts';
import {
  footerStateOf,
  listTotal,
  loadedItems,
  useLoadMore,
} from '../../../lib/ui/batched-list.ts';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { ListFooter } from '../../../lib/ui/list-footer.tsx';
import { RetryStatus } from '../../../lib/ui/retry-status.tsx';
import { showToast } from '../../../lib/ui/toast.tsx';
import { changedSelection } from '../domain/save-decision.ts';
import { isNarrowed, type VocabularyQuery } from '../domain/vocabulary-query.ts';
import { useDeletion } from './card-deletion.tsx';
import { useNavigationReset, useShowing } from './list-visit.ts';
import { cardPath, cardTitleSelector } from './paths.ts';
import { useVocabularyList, vocabularyListKey, type CardListItem } from './vocabulary-api.ts';
import { ModeButtons, QueryControls, SelectionBar } from './vocabulary-controls.tsx';
import { rememberScroll, setSelection, startOver, useVocabularyStore } from './vocabulary-store.ts';
import { WordCard } from './word-card.tsx';

const LOAD_FAILED = "Couldn't load words.";
const LOAD_MORE_FAILED = "Couldn't load more words.";
const TOO_MANY = 'Select up to 100 words at a time.';

type VocabularyList = ReturnType<typeof useVocabularyList>;

const cardTitle = (id: string) => document.querySelector<HTMLElement>(cardTitleSelector(id));

type CardListProps = {
  query: VocabularyQuery;
  list: VocabularyList;
  items: CardListItem[];
  selecting: boolean;
  selected: readonly string[];
  swiped: string | null;
  onSwipe: (id: string | null) => void;
  onSelect: (ids: string[], add: boolean) => void;
  onDelete: (ids: readonly string[]) => void;
};

/** Where the cards go: the failure, the first batch loading, the empty list or the cards. */
function CardList(props: CardListProps) {
  const { query, list, items, selecting, selected, swiped, onSwipe, onSelect, onDelete } = props;
  const router = useRouter();
  const loadMore = useLoadMore(list, items.length, cardTitle);

  if (list.isError && !list.data) {
    return (
      <div className="px-3.5 py-[25px]">
        <RetryStatus
          message={LOAD_FAILED}
          onRetry={offersRetry(list.error) ? () => void list.refetch() : undefined}
        />
      </div>
    );
  }
  if (list.isPending) {
    return <ListFooter state={{ kind: 'loading' }} onLoadMore={() => undefined} />;
  }
  if (items.length === 0) {
    return (
      <div className="px-3.5 py-[25px] text-muted">
        {isNarrowed(query)
          ? 'No words match.'
          : 'No words yet. Select a word while reading to look it up.'}
      </div>
    );
  }

  const activate = (id: string) => {
    if (selecting) {
      onSelect([id], !selected.includes(id));
    } else if (swiped !== null) {
      onSwipe(null);
    } else {
      rememberScroll();
      router.push(cardPath(id));
    }
  };

  const now = new Date();
  return (
    <>
      {items.map((card) => (
        <WordCard
          key={card.id}
          card={card}
          now={now}
          selecting={selecting}
          selected={selected.includes(card.id)}
          open={swiped === card.id}
          onActivate={activate}
          onToggle={(id) => onSelect([id], !selected.includes(id))}
          onSwipe={(id, open) => onSwipe(open ? id : null)}
          onLongPress={(id) => {
            onSwipe(null);
            setSelection(true, [id]);
            showToast('1 word selected.');
          }}
          onDelete={(card) => onDelete([card.id])}
        />
      ))}
      <ListFooter
        state={footerStateOf(list, LOAD_MORE_FAILED, () => loadMore(true))}
        onLoadMore={loadMore}
        autoLoad={!selecting}
      />
    </>
  );
}

export function VocabularyScreen() {
  const queryClient = useQueryClient();
  const { query, selecting, selected } = useVocabularyStore(
    useShallow((state) => ({
      query: state.query,
      selecting: state.selecting,
      selected: state.selected,
    })),
  );
  const list = useVocabularyList(query);
  const items = loadedItems(list.data);
  const total = listTotal(list);
  const [swiped, setSwiped] = useState<string | null>(null);
  const deletion = useDeletion({ query, items, onDeleted: () => setSwiped(null) });

  const startFresh = () => {
    setSwiped(null);
    void queryClient.resetQueries({ queryKey: vocabularyListKey(startOver()), exact: true });
    window.scrollTo(0, 0);
  };
  useShowing(Boolean(list.data), startFresh);
  useNavigationReset(startFresh);

  const changeQuery = (change: Partial<VocabularyQuery>) => {
    const next = { ...query, ...change };
    queryClient.removeQueries({ queryKey: vocabularyListKey(next), exact: true });
    useVocabularyStore.setState({ query: next });
  };

  const select = (ids: string[], add: boolean) => {
    const next = changedSelection(selected, ids, add);
    if (next === null) {
      showToast(TOO_MANY);
    } else {
      setSelection(true, next);
    }
  };

  return (
    <main className="px-3 py-[15px]">
      <div className="mb-[15px] flex items-center justify-between gap-2.5">
        <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-[-0.3px]">Vocabulary</h1>
        <Button
          shape="icon"
          aria-label={selecting ? 'Finish selecting' : 'Select words'}
          aria-pressed={selecting}
          onClick={() => {
            setSwiped(null);
            setSelection(!selecting);
          }}
        >
          <Icon name={selecting ? 'x' : 'list-checks'} />
        </Button>
      </div>
      <ModeButtons disabled={selecting} />
      <QueryControls query={query} total={total} onChange={changeQuery} />
      {selecting ? (
        <SelectionBar
          items={items}
          selected={selected}
          onSelectLoaded={(all) =>
            select(
              items.map((item) => item.id),
              all,
            )
          }
          onDelete={() => deletion.confirm(selected)}
        />
      ) : null}
      <div className="min-w-0 rounded-[5px] border border-line bg-surface">
        <CardList
          query={query}
          list={list}
          items={items}
          selecting={selecting}
          selected={selected}
          swiped={swiped}
          onSwipe={setSwiped}
          onSelect={select}
          onDelete={deletion.confirm}
        />
      </div>
      {deletion.dialog}
    </main>
  );
}
