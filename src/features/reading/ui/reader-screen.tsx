'use client';

// The reader (.docs/design/screens.md, 阅读页和播放器): `← Articles`, the article head with the
// source, title, length and the top play and Select words buttons, the sentences, the source's
// attribution at the end and the player at the bottom. Opening the reader records the visit,
// without a notice when that fails. An article that no longer exists sends the person back to
// the list with a notice; another failure shows in place of the text with Retry, and no player.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { hasErrorCode, offersRetry } from '../../../lib/api/client.ts';
import { formatFullDateTime } from '../../../lib/format/time-text.ts';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { useLookupBridge } from '../../../lib/ui/lookup-bridge.ts';
import { useCloseTo } from '../../../lib/ui/navigation-history.tsx';
import { RetryStatus } from '../../../lib/ui/retry-status.tsx';
import { countWords, listeningMinutes } from '../domain/reading.ts';
import { recordVisit, useArticle, type ReaderArticle } from './article-api.ts';
import { restoreListOnReturn } from './article-list-store.ts';
import { articleGone, open, playSentence, toggle } from './player.ts';
import { PlayerBar } from './player-bar.tsx';
import { ARTICLES_PATH } from './player-host.tsx';
import { isPlaying, usePlayerStore, type PlayerStatus } from './player-store.ts';
import { ReaderText } from './reader-text.tsx';
import { categoryName, feedOf, SourceMark } from './source-mark.tsx';

const LOAD_FAILED = "Couldn't load this article.";

function BackToArticles() {
  const close = useCloseTo(ARTICLES_PATH);
  return (
    <div className="mb-[15px] flex items-center justify-between gap-2.5">
      <Button
        variant="flat"
        onClick={() => {
          restoreListOnReturn();
          close();
        }}
      >
        <Icon name="arrow-left" />
        Articles
      </Button>
    </div>
  );
}

type View = {
  /** Whether the player holds this article; until it does, the article shows as not played. */
  current: boolean;
  status: PlayerStatus;
  mode: 'article' | 'sentence';
  sentence: number;
  started: boolean;
  selected: number | null;
};

function usePlayerView(articleId: string): View {
  return usePlayerStore(
    useShallow((state) => {
      const current = state.article?.id === articleId;
      return {
        current,
        status: current ? state.status : 'idle',
        mode: state.mode,
        sentence: current ? state.sentence : 0,
        started: current && state.started,
        selected: current ? state.selected : null,
      };
    }),
  );
}

function topButtonLabel(view: View) {
  if (isPlaying(view.status) && view.mode === 'article') {
    return 'Pause article';
  }
  if (view.selected !== null) {
    return `Play article from sentence ${view.selected + 1}`;
  }
  return view.started ? 'Resume article' : 'Play article';
}

function Attribution({ article }: { article: ReaderArticle }) {
  const feed = feedOf(article.feedKey);
  const collected = formatFullDateTime(new Date(article.collectedAt));
  return (
    <footer
      aria-label="Source"
      className="grid gap-0.5 border-t border-line pt-3 pr-3 pb-1.5 pl-4 text-xs text-muted"
    >
      <SourceMark feedKey={article.feedKey} className="text-[13px] text-ink" />
      <p>
        {feed?.attribution}
        {article.author ? ` By ${article.author}.` : ''}
        {feed?.license ? (
          <>
            {' '}
            <a className="text-accent" href={feed.license.url}>
              {feed.license.name}
            </a>
          </>
        ) : null}
      </p>
      <div className="flex items-center justify-between gap-2.5">
        <a
          className="inline-flex min-h-11 items-center gap-1 text-accent underline"
          href={article.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Original
          <Icon name="external-link" />
        </a>
        <time
          dateTime={article.collectedAt}
          aria-label={`Collected ${collected}`}
          className="text-[11px] whitespace-nowrap"
        >
          {collected}
        </time>
      </div>
    </footer>
  );
}

function SelectWordsButton({ article }: { article: ReaderArticle }) {
  const bridge = useLookupBridge();
  const button = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={button}
      type="button"
      className="inline-flex min-h-11 w-11 items-center justify-center disabled:opacity-45"
      aria-label="Select words for lookup"
      disabled={!bridge}
      onClick={() => {
        if (bridge && button.current) {
          bridge.openSelectionTool({
            anchor: button.current,
            context: { kind: 'article', articleId: article.id, sentences: article.sentences },
          });
        }
      }}
    >
      <Icon name="text-cursor-input" />
    </button>
  );
}

function ArticleHead({ article, view }: { article: ReaderArticle; view: View }) {
  const words = countWords(article.sentences.map((sentence) => sentence.text));
  const playing = isPlaying(view.status) && view.mode === 'article';
  return (
    <header className="border-b border-line px-3 py-[15px]">
      <div className="flex flex-wrap items-center gap-[9px] text-[11px] text-muted">
        <SourceMark feedKey={article.feedKey} />
        <span>{categoryName(article.categoryKey)}</span>
      </div>
      <h1 className="my-[9px] text-[21px] leading-[1.3] font-semibold tracking-[-0.3px]">
        {article.title}
      </h1>
      <div className="text-[11px] text-muted">
        {words} words · {listeningMinutes(article.durationMs)} min listening
      </div>
      <div className="mt-3 flex items-center gap-[9px]">
        <Button variant="primary" shape="icon" aria-label={topButtonLabel(view)} onClick={toggle}>
          <Icon name={playing ? 'pause' : 'play'} />
        </Button>
        <SelectWordsButton article={article} />
      </div>
    </header>
  );
}

function Reader({ article }: { article: ReaderArticle }) {
  const view = usePlayerView(article.id);
  const highlighted = view.current && (view.status !== 'idle' || view.selected !== null);
  return (
    <article className="relative rounded-t-[5px] border border-b-0 border-line bg-surface">
      <ArticleHead article={article} view={view} />
      <ReaderText
        articleId={article.id}
        sentences={article.sentences}
        active={highlighted ? view.sentence : null}
        selected={view.selected}
        following={view.status === 'playing'}
        onPlaySentence={playSentence}
      />
      <Attribution article={article} />
      <PlayerBar
        title={article.title}
        sentenceCount={article.sentences.length}
        sentence={view.sentence}
        current={view.current}
      />
    </article>
  );
}

export function ReaderScreen({ articleId }: { articleId: string }) {
  const queryClient = useQueryClient();
  const article = useArticle(articleId);

  useEffect(() => {
    recordVisit(queryClient, articleId).catch(() => undefined);
  }, [queryClient, articleId]);

  useEffect(() => {
    if (article.data) {
      open(article.data);
    }
  }, [article.data]);

  const gone = hasErrorCode(article.error, 'NOT_FOUND');
  useEffect(() => {
    if (gone) {
      articleGone(articleId);
    }
  }, [gone, articleId]);

  let content = null;
  if (article.data) {
    content = <Reader article={article.data} />;
  } else if (article.isError && !gone) {
    content = (
      <article className="rounded-[5px] border border-line bg-surface">
        <div className="px-3.5 py-[25px] text-muted">
          <RetryStatus
            message={LOAD_FAILED}
            onRetry={offersRetry(article.error) ? () => void article.refetch() : undefined}
          />
        </div>
      </article>
    );
  }

  return (
    <main className="px-3 pt-[15px]" aria-busy={article.isPending}>
      <BackToArticles />
      {content}
    </main>
  );
}
