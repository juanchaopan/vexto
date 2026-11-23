'use client';

// The controls above the Vocabulary list (.docs/design/screens.md, Vocabulary 上有什么 and
// Vocabulary 的字段): the Speak, Spell and Translate buttons with their red due and yellow new
// counts (Speak is not there yet; the others are disabled in selection mode); the All, New,
// Ongoing and Archived tabs; the search and the count; a round filter for each mode and the sort;
// and in selection mode the bar with `Loaded`, the count of chosen words, Delete and Cancel.
import { useRouter } from 'next/navigation';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { FilterControl, SortControl } from '../../../lib/ui/list-controls.tsx';
import { useReviewCounts, type ModeCounts } from '../../../lib/ui/review-counts.ts';
import { SearchBox } from '../../../lib/ui/search-box.tsx';
import { REVIEW_MODES } from '../domain/review-progress.ts';
import {
  effectiveRounds,
  ROUND_CHOICES,
  VOCABULARY_SEARCH_MAX_LENGTH,
  type VocabularyQuery,
  type VocabularySort,
  type VocabularyState,
} from '../domain/vocabulary-query.ts';
import { reviewPath } from './paths.ts';
import { MODE_ICONS, MODE_NAMES } from './progress-groups.tsx';
import type { CardListItem } from './vocabulary-api.ts';
import { setSelection } from './vocabulary-store.ts';

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

const countText = (total: number) => `${total} ${total === 1 ? 'word' : 'words'}`;

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

export function ModeButtons({ disabled }: { disabled: boolean }) {
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

export type QueryControlsProps = {
  query: VocabularyQuery;
  total: number | undefined;
  onChange: (change: Partial<VocabularyQuery>) => void;
};

/** The tabs, the search with the count, the round filters and the sort. */
export function QueryControls({ query, total, onChange }: QueryControlsProps) {
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

export type SelectionBarProps = {
  items: readonly CardListItem[];
  selected: readonly string[];
  onSelectLoaded: (all: boolean) => void;
  onDelete: () => void;
};

export function SelectionBar({ items, selected, onSelectLoaded, onDelete }: SelectionBarProps) {
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
