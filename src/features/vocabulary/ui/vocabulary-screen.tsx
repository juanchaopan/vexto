'use client';

// The Vocabulary screen (.docs/design/screens.md, Vocabulary, screens 30–41, 60 and 65–68): the
// title and the selection mode button; the Speak, Spell and Translate buttons with their counts,
// the only way into a review; the All, New, Ongoing and Archived tabs; the search and the count;
// the three round filters and the sort; and the cards in batches of 20. Changing the tab, a
// filter, the sort or the search starts again from the first batch.
//
// Coming back from card details or a review restores the list as it was, with the focus on what
// was opened; any other way in starts over with no search, Word ascending and one batch, the tab
// and the round filters kept, and so does the top bar's Vocabulary button pressed on this screen.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { offersRetry } from '../../../lib/api/client.ts';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { FilterControl, SortControl } from '../../../lib/ui/list-controls.tsx';
import { ListFooter, type ListFooterState } from '../../../lib/ui/list-footer.tsx';
import { RetryStatus } from '../../../lib/ui/retry-status.tsx';
import { useReviewCounts, type ModeCounts } from '../../../lib/ui/review-counts.ts';
import { SearchBox } from '../../../lib/ui/search-box.tsx';
import { showToast } from '../../../lib/ui/toast.tsx';
import {
  clearVocabularyReturn,
  peekVocabularyReturn,
  type VocabularyReturn,
} from '../../../lib/ui/vocabulary-return.ts';
import { REVIEW_MODES, type ReviewMode } from '../domain/review-progress.ts';
import { changedSelection } from '../domain/save-decision.ts';
import {
  effectiveRounds,
  isNarrowed,
  ROUND_CHOICES,
  VOCABULARY_SEARCH_MAX_LENGTH,
  type VocabularyQuery,
  type VocabularySort,
  type VocabularyState,
} from '../domain/vocabulary-query.ts';
import { useDeletion } from './card-deletion.tsx';
import { MODE_ICONS, MODE_NAMES } from './progress-groups.tsx';
import {
  loadedCards,
  useVocabularyList,
  vocabularyListKey,
  type CardListItem,
} from './vocabulary-api.ts';
import { rememberScroll, setSelection, startOver, useVocabularyStore } from './vocabulary-store.ts';
import { WordCard } from './word-card.tsx';

export const VOCABULARY_PATH = '/vocabulary';

const LOAD_FAILED = "Couldn't load words.";
const LOAD_MORE_FAILED = "Couldn't load more words.";
const MORE_LOADED = 'More records loaded.';
const TOO_MANY = 'Select up to 100 words at a time.';

const tabs: { value: VocabularyState; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'archived', label: 'Archived' },
];

const roundOptions = ROUND_CHOICES.map((choice) => ({
  value: choice,
  name: choice === 'complete' ? 'Complete' : `Round ${choice}`,
}));

const sortFields: { value: VocabularySort; label: string }[] = [
  { value: 'word', label: 'Word' },
  ...REVIEW_MODES.flatMap((mode) => [
    { value: `${mode}Round` as VocabularySort, label: `${MODE_NAMES[mode]} round` },
    { value: `${mode}Next` as VocabularySort, label: `${MODE_NAMES[mode]} next` },
  ]),
];

/** The path of a mode's review. */
export const reviewPath = (mode: ReviewMode) => `/review/${mode}`;

/** The path of a card's details. */
export const cardPath = (id: string) => `${VOCABULARY_PATH}/${encodeURIComponent(id)}`;

function cardTitle(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-card-id="${CSS.escape(id)}"] [data-card-title]`,
  );
}

const countText = (total: number) => `${total} ${total === 1 ? 'word' : 'words'}`;

type VocabularyList = ReturnType<typeof useVocabularyList>;

/**
 * Whether this visit returns to the list or starts it over. Starting over happens before the
 * first batch is asked for, so the old search is never loaded.
 */
function useVisit(): VocabularyReturn | null {
  const queryClient = useQueryClient();
  const [visit] = useState(() => {
    const returning = peekVocabularyReturn();
    if (!returning) {
      void queryClient.resetQueries({ queryKey: vocabularyListKey(startOver()), exact: true });
    }
    return returning;
  });
  useEffect(() => clearVocabularyReturn(), []);
  return visit;
}

/** Back from card details or a review: the scroll position and the focus of that moment. */
function useRestore(visit: VocabularyReturn | null, loaded: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    if (!visit || !loaded || restored.current) {
      return;
    }
    restored.current = true;
    window.scrollTo(0, useVocabularyStore.getState().scrollY);
    if (visit.focus) {
      document.querySelector<HTMLElement>(visit.focus)?.focus({ preventScroll: true });
    }
  }, [visit, loaded]);
}

/** The top bar's Vocabulary button pressed while the screen shows: the list starts over. */
function useNavigationReset(onReset: () => void) {
  const reset = useRef(onReset);
  useEffect(() => {
    reset.current = onReset;
  });
  useEffect(() => {
    const onClick = (event: globalThis.MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (link && new URL((link as HTMLAnchorElement).href).pathname === VOCABULARY_PATH) {
        reset.current();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

function footerState(list: VocabularyList, retry: () => void): ListFooterState {
  if (list.isFetchingNextPage) {
    return { kind: 'loading' };
  }
  if (list.isFetchNextPageError) {
    return {
      kind: 'failed',
      message: LOAD_MORE_FAILED,
      onRetry: offersRetry(list.error) ? retry : undefined,
    };
  }
  return list.hasNextPage ? { kind: 'more' } : { kind: 'done' };
}

/** Loading the next batch: a notice once it is in, and after Load more the focus on its first card. */
function useLoadMore(list: VocabularyList, count: number) {
  const focusTarget = useRef<string | null>(null);
  useEffect(() => {
    const title = focusTarget.current ? cardTitle(focusTarget.current) : null;
    if (title) {
      focusTarget.current = null;
      title.focus();
    }
  });
  return (manual: boolean) => {
    void list.fetchNextPage().then((result) => {
      if (result.isFetchNextPageError) {
        return;
      }
      showToast(MORE_LOADED);
      const first = loadedCards(result.data)[count];
      if (manual && first) {
        focusTarget.current = first.id;
      }
    });
  };
}

function Badges({ counts }: { counts: ModeCounts }) {
  const dot =
    'grid h-5 min-w-5 place-items-center rounded-full border-2 border-page px-[3px] text-[10px] font-semibold';
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -top-2.5 -right-2 flex gap-[3px]"
    >
      {counts.due > 0 ? (
        <span className={`${dot} bg-danger text-on-danger`}>{counts.due}</span>
      ) : null}
      {counts.new > 0 ? (
        <span className={`${dot} bg-badge-new text-on-badge-new`}>{counts.new}</span>
      ) : null}
    </span>
  );
}

function ModeButtons({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const counts = useReviewCounts();
  return (
    <div className="mt-[15px] mb-[17px] flex flex-nowrap gap-[15px] px-1 pt-1.5">
      <div className="relative inline-flex min-w-0 flex-1">
        <Button className="w-full min-w-0 p-1.5" disabled aria-label="Speak, coming soon">
          <Icon name={MODE_ICONS.speak} />
          <span className="text-xs font-normal">Coming soon</span>
        </Button>
      </div>
      {(['spell', 'translate'] as const).map((mode) => {
        const modeCounts = counts?.[mode];
        return (
          <div key={mode} className="relative inline-flex min-w-0 flex-1">
            <Button
              className="w-full min-w-0 p-1.5"
              data-review-mode={mode}
              disabled={disabled}
              aria-label={
                modeCounts
                  ? `${MODE_NAMES[mode]}, ${modeCounts.due} due, ${modeCounts.new} new`
                  : MODE_NAMES[mode]
              }
              onClick={() => router.push(reviewPath(mode))}
            >
              <Icon name={MODE_ICONS[mode]} />
            </Button>
            {modeCounts ? <Badges counts={modeCounts} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function Tabs({
  state,
  onChange,
}: {
  state: VocabularyState;
  onChange: (state: VocabularyState) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Word state"
      className="mb-[13px] flex flex-wrap gap-4 border-b border-line"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          aria-pressed={state === tab.value}
          className="min-h-11 min-w-11 border-b-2 border-transparent px-px pt-1.5 pb-[9px] text-xs font-medium aria-pressed:border-accent aria-pressed:text-accent"
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

type QueryControlsProps = {
  query: VocabularyQuery;
  total: number | undefined;
  onChange: (change: Partial<VocabularyQuery>) => void;
};

/** The tabs, the search with the count, the round filters and the sort. */
function QueryControls({ query, total, onChange }: QueryControlsProps) {
  return (
    <>
      <Tabs state={query.state} onChange={(state) => onChange({ state })} />
      <div className="my-[11px] flex flex-wrap items-center gap-[7px]">
        <SearchBox
          key={query.q}
          placeholder="Search words, examples, 中文"
          maxLength={VOCABULARY_SEARCH_MAX_LENGTH}
          value={query.q}
          onSearch={(q) => onChange({ q })}
        />
        <span className="ml-auto text-xs whitespace-nowrap text-muted">
          {total === undefined ? '' : countText(total)}
        </span>
      </div>
      <div className="my-[11px] flex flex-nowrap items-center gap-1.5">
        {REVIEW_MODES.map((mode) => (
          <FilterControl
            key={mode}
            title={`${MODE_NAMES[mode]} round`}
            icon={MODE_ICONS[mode]}
            options={roundOptions}
            selected={query.rounds[mode]}
            onApply={(values) =>
              onChange({ rounds: { ...query.rounds, [mode]: effectiveRounds(values) } })
            }
          />
        ))}
        <SortControl
          fields={sortFields}
          field={query.sort}
          direction={query.direction}
          onField={(sort) => onChange({ sort })}
          onDirection={(direction) => onChange({ direction })}
        />
      </div>
    </>
  );
}

type SelectionBarProps = {
  items: readonly CardListItem[];
  selected: readonly string[];
  onSelectLoaded: (all: boolean) => void;
  onDelete: () => void;
};

function SelectionBar({ items, selected, onSelectLoaded, onDelete }: SelectionBarProps) {
  const allLoaded = items.length > 0 && items.every((item) => selected.includes(item.id));
  return (
    <div
      role="region"
      aria-label="Selected words"
      className="mb-[9px] flex min-h-12 items-center gap-[3px] rounded border border-line bg-soft px-1 py-0.5 text-xs"
    >
      <div className="flex items-center gap-[3px] whitespace-nowrap">
        <label className="inline-flex min-h-11 w-11 flex-none items-center justify-center">
          <input
            type="checkbox"
            className="m-0 size-[17px] accent-accent"
            aria-label="Select loaded words"
            checked={allLoaded}
            disabled={items.length === 0}
            onChange={() => onSelectLoaded(!allLoaded)}
          />
        </label>
        <span>Loaded</span>
      </div>
      <span role="status" className="ml-auto text-[11px] whitespace-nowrap">
        {selected.length} selected
      </span>
      <Button
        shape="icon"
        className="text-muted"
        aria-label={`Delete ${selected.length} selected words`}
        disabled={selected.length === 0}
        onClick={onDelete}
      >
        <Icon name="trash-2" />
      </Button>
      <Button
        variant="flat"
        shape="icon"
        aria-label="Cancel selection"
        onClick={() => setSelection(false)}
      >
        <Icon name="x" />
      </Button>
    </div>
  );
}

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
  const loadMore = useLoadMore(list, items.length);

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
        state={footerState(list, () => loadMore(true))}
        onLoadMore={loadMore}
        autoLoad={!selecting}
      />
    </>
  );
}

export function VocabularyScreen() {
  const queryClient = useQueryClient();
  const visit = useVisit();
  const { query, selecting, selected } = useVocabularyStore(
    useShallow((state) => ({
      query: state.query,
      selecting: state.selecting,
      selected: state.selected,
    })),
  );
  const list = useVocabularyList(query);
  const items = loadedCards(list.data);
  const total = list.isError && !list.data ? undefined : list.data?.pages[0]?.meta.totalCount;
  const [swiped, setSwiped] = useState<string | null>(null);
  const deletion = useDeletion({ query, items, onDeleted: () => setSwiped(null) });
  useRestore(visit, Boolean(list.data));
  useNavigationReset(() => {
    setSwiped(null);
    void queryClient.resetQueries({ queryKey: vocabularyListKey(startOver()), exact: true });
    window.scrollTo(0, 0);
  });

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
