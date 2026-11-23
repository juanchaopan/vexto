'use client';

// The Articles screen (.docs/design/screens.md, Articles): the title and Play all, the search box
// and the count, the Source, Category and sort controls, and the cards in batches of 20. Applying
// a filter, changing the sort or submitting a search starts again from the first batch. Coming
// back from the reader restores the scroll position and puts the focus on the article that was
// opened; a continuous play moving to its next article has the list load up to it and show it.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isAccessError, offersRetry } from '../../../lib/api/client.ts';
import { sharedConfig } from '../../../lib/config/shared-config.ts';
import {
  footerStateOf,
  listTotal,
  loadedItems,
  useLoadMore,
} from '../../../lib/ui/batched-list.ts';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { FilterControl, SortControl } from '../../../lib/ui/list-controls.tsx';
import { ListFooter } from '../../../lib/ui/list-footer.tsx';
import { RetryStatus } from '../../../lib/ui/retry-status.tsx';
import { SearchBox } from '../../../lib/ui/search-box.tsx';
import { showToast } from '../../../lib/ui/toast.tsx';
import {
  ARTICLE_SEARCH_MAX_LENGTH,
  effectiveChoices,
  isNarrowed,
  type ArticleQuery,
  type ArticleSort,
} from '../domain/article-query.ts';
import {
  articleListKey,
  fetchArticleIds,
  useArticleList,
  type ArticleListItem,
} from './article-api.ts';
import { ArticleCard } from './article-card.tsx';
import { rememberOpened, revealInList, useArticleListStore } from './article-list-store.ts';
import { isActive, PLAY_FAILED, preparePlayback, startQueue, stop } from './player.ts';
import { readerPath } from './player-host.tsx';
import { SourceMark } from './source-mark.tsx';

const LOAD_FAILED = "Couldn't load articles.";
const LOAD_MORE_FAILED = "Couldn't load more articles.";

const feedKeys = sharedConfig.feeds.map((feed) => feed.key);
const categoryKeys = sharedConfig.categories.map((category) => category.key);

const feedOptions = sharedConfig.feeds.map((feed) => ({
  value: feed.key,
  name: feed.name,
  label: <SourceMark feedKey={feed.key} />,
}));
const categoryOptions = sharedConfig.categories.map((category) => ({
  value: category.key,
  name: category.name,
}));

const sortFields: { value: ArticleSort; label: string }[] = [
  { value: 'collected', label: 'Collected' },
  { value: 'visited', label: 'Last visited' },
  { value: 'article', label: 'Article' },
  { value: 'source', label: 'Source' },
  { value: 'category', label: 'Category' },
];

function cardTitle(articleId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-article-id="${CSS.escape(articleId)}"] button`);
}

function countText(total: number) {
  return `${total} ${total === 1 ? 'article' : 'articles'}`;
}

type ArticleList = ReturnType<typeof useArticleList>;

/** Back from the reader: the scroll position and focus of the moment the article was opened. */
function useRestoreOnReturn(loaded: boolean) {
  const { restoring, opened } = useArticleListStore(
    useShallow((state) => ({ restoring: state.restoring, opened: state.opened })),
  );
  useEffect(() => {
    if (!restoring || !loaded) {
      return;
    }
    useArticleListStore.setState({ restoring: false });
    if (opened) {
      window.scrollTo(0, opened.scrollY);
      cardTitle(opened.articleId)?.focus({ preventScroll: true });
    }
  }, [restoring, loaded, opened]);
}

/** Loads batches until the article a continuous play moves to is in the list, then shows it. */
function useReveal(list: ArticleList, items: readonly ArticleListItem[]) {
  const reveal = useArticleListStore((state) => state.reveal);
  useEffect(() => {
    if (!reveal || !list.data) {
      return;
    }
    if (items.some((item) => item.id === reveal)) {
      cardTitle(reveal)?.scrollIntoView({ block: 'center' });
      revealInList(null);
    } else if (list.hasNextPage && !list.isFetchNextPageError) {
      if (!list.isFetchingNextPage) {
        void list.fetchNextPage();
      }
    } else {
      revealInList(null);
    }
  }, [reveal, list, items]);
}

function useListActions(query: ArticleQuery, list: ArticleList, items: ArticleListItem[]) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const loadMore = useLoadMore(list, items.length, cardTitle);

  const changeQuery = (change: Partial<ArticleQuery>) => {
    const next = { ...query, ...change };
    queryClient.removeQueries({ queryKey: articleListKey(next), exact: true });
    useArticleListStore.setState({ query: next });
  };

  const openArticle = (id: string) => {
    if (isActive()) {
      stop();
    }
    rememberOpened(id);
    router.push(readerPath(id));
  };

  const play = (startId: string | null) => {
    preparePlayback();
    fetchArticleIds(queryClient, query)
      .then((ids) => {
        const first = startId ?? ids[0];
        if (first) {
          startQueue(ids, first);
        }
      })
      .catch((error: unknown) => {
        if (!isAccessError(error)) {
          showToast(PLAY_FAILED, offersRetry(error) ? { retry: () => play(startId) } : {});
        }
      });
  };

  return { changeQuery, openArticle, play, loadMore };
}

type ListContentProps = {
  query: ArticleQuery;
  list: ArticleList;
  items: ArticleListItem[];
  actions: ReturnType<typeof useListActions>;
};

/** Where the cards go: the failure, the first batch loading, the empty list or the cards. */
function ListContent({ query, list, items, actions }: ListContentProps) {
  if (list.isError && !list.data) {
    return (
      <div className="px-3.5 py-[25px] text-muted">
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
        {isNarrowed(query) ? 'No articles match.' : 'No articles yet.'}
      </div>
    );
  }
  return (
    <>
      {items.map((article) => (
        <ArticleCard
          key={article.id}
          article={article}
          onOpen={actions.openArticle}
          onPlay={actions.play}
        />
      ))}
      <ListFooter
        state={footerStateOf(list, LOAD_MORE_FAILED, () => actions.loadMore(true))}
        onLoadMore={actions.loadMore}
      />
    </>
  );
}

export function ArticlesScreen() {
  const query = useArticleListStore((state) => state.query);
  const list = useArticleList(query);
  const items = loadedItems(list.data);
  const total = listTotal(list);
  const actions = useListActions(query, list, items);
  const { changeQuery } = actions;
  useRestoreOnReturn(Boolean(list.data));
  useReveal(list, items);

  return (
    <main className="px-3 py-[15px]">
      <div className="mb-[15px] flex items-center justify-between gap-2.5">
        <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-[-0.3px]">Articles</h1>
        <Button
          variant="primary"
          shape="icon"
          aria-label="Play all articles"
          disabled={items.length === 0}
          onClick={() => actions.play(null)}
        >
          <Icon name="play" />
        </Button>
      </div>
      <div className="my-[11px] flex flex-wrap items-center gap-[7px]">
        <SearchBox
          placeholder="Search article text"
          maxLength={ARTICLE_SEARCH_MAX_LENGTH}
          value={query.q}
          onSearch={(q) => changeQuery({ q })}
        />
        <span className="ml-auto text-xs whitespace-nowrap text-muted">
          {total === undefined ? '' : countText(total)}
        </span>
      </div>
      <div className="my-[11px] flex flex-nowrap items-center gap-1.5">
        <FilterControl
          title="Source"
          icon="building-2"
          options={feedOptions}
          selected={query.feeds}
          onApply={(values) => changeQuery({ feeds: effectiveChoices(values, feedKeys) })}
        />
        <FilterControl
          title="Category"
          icon="tag"
          options={categoryOptions}
          selected={query.categories}
          onApply={(values) => changeQuery({ categories: effectiveChoices(values, categoryKeys) })}
        />
        <SortControl
          fields={sortFields}
          field={query.sort}
          direction={query.direction}
          onField={(sort) => changeQuery({ sort })}
          onDirection={(direction) => changeQuery({ direction })}
        />
      </div>
      <div className="min-w-0 rounded-[5px] border border-line bg-surface">
        <ListContent query={query} list={list} items={items} actions={actions} />
      </div>
    </main>
  );
}
