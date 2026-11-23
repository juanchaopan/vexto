'use client';

// One article in the list (.docs/design/screens.md, Articles 上有什么): the title on one line and
// the first sentence on up to two, each cut short to fit; the play button that starts a
// continuous play from this article; the source mark, name and category; and when it was
// collected and, once the member has visited it, last visited. The whole card opens the reader:
// the title button is the card's control for keyboards and screen readers, and a press anywhere
// else on the card does the same for touch.
import type { MouseEvent } from 'react';
import { formatDateTime } from '../../../lib/format/time-text.ts';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import type { ArticleListItem } from './article-api.ts';
import { categoryName, SourceMark } from './source-mark.tsx';

export type ArticleCardProps = {
  article: ArticleListItem;
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
};

export function ArticleCard({ article, onOpen, onPlay }: ArticleCardProps) {
  const openFromCard = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target as Element).closest('button')) {
      onOpen(article.id);
    }
  };
  return (
    <article
      data-article-id={article.id}
      className="border-b border-line bg-surface px-3 py-[13px]"
      onClick={openFromCard}
    >
      <div className="flex items-start justify-between gap-[9px]">
        <div className="min-w-0">
          <button
            type="button"
            className="block min-h-7 max-w-full truncate p-0 text-left text-sm leading-normal font-medium text-accent select-none [-webkit-touch-callout:none]"
            onClick={() => onOpen(article.id)}
          >
            {article.title}
          </button>
          <span className="mt-[3px] line-clamp-2 text-xs text-muted">{article.excerpt}</span>
        </div>
        <Button
          shape="icon"
          aria-label={`Play ${article.title}`}
          onClick={() => onPlay(article.id)}
        >
          <Icon name="play" />
        </Button>
      </div>
      <div className="mt-[7px] flex flex-wrap items-center gap-[9px] text-[11px] text-muted">
        <SourceMark feedKey={article.feedKey} />
        <span>{categoryName(article.categoryKey)}</span>
      </div>
      <div className="mt-[7px] flex flex-wrap justify-between gap-2 text-[11px] text-muted">
        <span className="whitespace-nowrap">
          Collected {formatDateTime(new Date(article.collectedAt))}
        </span>
        {article.lastVisitedAt ? (
          <span className="whitespace-nowrap">
            Last visited {formatDateTime(new Date(article.lastVisitedAt))}
          </span>
        ) : null}
      </div>
    </article>
  );
}
