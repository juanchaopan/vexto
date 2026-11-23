// A source as the interface draws it (.docs/design/rules.md, 订阅源): the letter mark in the
// source's colour on a light tint of it, then the display name. Both come from the shared
// configuration by the feed key an article carries; a key the configuration no longer has shows
// the key itself.
import type { CSSProperties } from 'react';
import { sharedConfig, type FeedDisplay } from '../../../lib/config/shared-config.ts';

export function feedOf(key: string): FeedDisplay | undefined {
  return sharedConfig.feeds.find((feed) => feed.key === key);
}

export function feedName(key: string): string {
  return feedOf(key)?.name ?? key;
}

export function categoryName(key: string): string {
  return sharedConfig.categories.find((category) => category.key === key)?.name ?? key;
}

export function SourceMark({ feedKey, className = '' }: { feedKey: string; className?: string }) {
  const feed = feedOf(feedKey);
  const mark = { '--mark': feed?.color ?? 'var(--color-muted)' } as CSSProperties;
  return (
    <span className={`flex min-w-0 items-center gap-[5px] whitespace-nowrap ${className}`}>
      <span
        aria-hidden="true"
        style={mark}
        className="inline-grid h-[18px] min-w-[18px] flex-none place-items-center rounded px-[3px] text-[10px] leading-[18px] font-bold tracking-[0.2px] text-(--mark) [background:color-mix(in_srgb,var(--mark)_13%,var(--color-surface))]"
      >
        {feed?.mark ?? feedKey.slice(0, 2).toUpperCase()}
      </span>
      <span>{feedName(feedKey)}</span>
    </span>
  );
}
