// The three progress groups of a card (.docs/design/screens.md, Vocabulary 上有什么 and 词卡详情),
// one row per mode: the mode's icon, `Round <n>` (the round of the next answer) or `Complete`, and
// the time until the next review. A due mode says `Due` in red; a new word and a completed mode,
// which have no due time, show a dash, blue for a new word and green once complete.
import { formatTimeUntil } from '../../../lib/format/time-text.ts';
import { Icon, type IconName } from '../../../lib/ui/icon.tsx';
import {
  FINAL_ROUND,
  REVIEW_MODES,
  roundLabel,
  type CardProgress,
  type ModeProgress,
  type ReviewMode,
} from '../domain/review-progress.ts';

export const MODE_NAMES: Record<ReviewMode, string> = {
  speak: 'Speak',
  spell: 'Spell',
  translate: 'Translate',
};

export const MODE_ICONS: Record<ReviewMode, IconName> = {
  speak: 'mic',
  spell: 'keyboard',
  translate: 'languages',
};

function timeText(progress: ModeProgress, now: Date): { text: string; className: string } {
  if (progress.dueAt === null) {
    return {
      text: '—',
      className: progress.round >= FINAL_ROUND ? 'text-success' : 'text-accent',
    };
  }
  const text = formatTimeUntil(new Date(progress.dueAt), now);
  return { text, className: text === 'Due' ? 'text-danger' : 'text-muted' };
}

export type ProgressGroupsProps = {
  progress: CardProgress;
  /** The moment the times count from. */
  now: Date;
};

export function ProgressGroups({ progress, now }: ProgressGroupsProps) {
  return (
    <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)] gap-[5px]">
      {REVIEW_MODES.map((mode) => {
        const round = roundLabel(progress[mode].round);
        const time = timeText(progress[mode], now);
        return (
          <div
            key={mode}
            role="group"
            aria-label={`${MODE_NAMES[mode]}, ${round}, ${time.text}`}
            className="flex min-w-0 items-center gap-[9px] overflow-hidden rounded border border-line bg-page px-2 py-[5px] text-xs whitespace-nowrap"
          >
            <span className="inline-flex flex-none items-center text-muted">
              <Icon name={MODE_ICONS[mode]} className="size-[15px]!" />
            </span>
            <span className="min-w-0 truncate">{round}</span>
            <span
              className={`flex-none border-l border-line pl-[9px] text-[11px] ${time.className}`}
            >
              {time.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
