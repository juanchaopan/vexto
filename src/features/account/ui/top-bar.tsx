'use client';

// The top bar of every screen inside the application (.docs/design/screens.md, 顶栏): the vexto
// mark, the Articles and Vocabulary buttons, and the avatar that opens the account menu. The
// button of the group the current screen belongs to is highlighted. The Vocabulary button carries
// the red count of due reviews and the yellow count of new reviews; a count of 0 is not drawn,
// and without counts neither dot is.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buttonClassName } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { AccountMenu, type AccountMenuProps } from './account-menu.tsx';
import { Brand } from './brand.tsx';

export type ReviewCounts = { due: number; new: number };

export type TopBarProps = AccountMenuProps & {
  /** The review counts on the Vocabulary button, once they are known. */
  counts?: ReviewCounts;
};

export const ARTICLES_PATH = '/';
export const VOCABULARY_PATH = '/vocabulary';

const vocabularyGroup = [VOCABULARY_PATH, '/review'];

function inVocabularyGroup(pathname: string) {
  return vocabularyGroup.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

const navClass = `${buttonClassName('default', 'icon')} rounded-[5px] border-line bg-none bg-surface aria-[current=page]:border-[color-mix(in_srgb,var(--color-accent),var(--color-line)_50%)] aria-[current=page]:bg-soft aria-[current=page]:text-accent`;

function Badges({ counts }: { counts: ReviewCounts }) {
  const dot =
    'grid h-[18px] min-w-[18px] place-items-center rounded-[9px] border-2 border-surface px-[3px] text-[10px] font-semibold';
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -top-2 -right-[5px] flex gap-0.5"
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

export function TopBar({ counts, ...menu }: TopBarProps) {
  const pathname = usePathname();
  const onVocabulary = inVocabularyGroup(pathname);
  const vocabularyLabel = counts
    ? `Vocabulary, ${counts.due} due reviews, ${counts.new} new reviews`
    : 'Vocabulary';
  return (
    <header className="flex min-w-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 pt-4 pb-[9px]">
      <Brand showName={false} />
      <nav
        aria-label="Main navigation"
        className="flex min-w-0 flex-1 items-center justify-end gap-3"
      >
        <Link
          href={ARTICLES_PATH}
          aria-label="Articles"
          aria-current={onVocabulary ? undefined : 'page'}
          className={navClass}
        >
          <Icon name="newspaper" />
        </Link>
        <span className="relative block">
          <Link
            href={VOCABULARY_PATH}
            aria-label={vocabularyLabel}
            aria-current={onVocabulary ? 'page' : undefined}
            className={navClass}
          >
            <Icon name="book-open" />
          </Link>
          {counts ? <Badges counts={counts} /> : null}
        </span>
      </nav>
      <AccountMenu {...menu} />
    </header>
  );
}
