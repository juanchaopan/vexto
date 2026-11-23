'use client';

// The state of the Articles screen that outlives the screen (.docs/design/screens.md, 列表的分批
// 加载 and 顶栏): the search, filters and sort; where the list was when an article was opened, so
// the reader's way back restores the scroll position and the focus; and the article a continuous
// play moves to next, which the list loads and shows before the reader opens it.
import { create } from 'zustand';
import { DEFAULT_ARTICLE_QUERY, type ArticleQuery } from '../domain/article-query.ts';

type ArticleListState = {
  query: ArticleQuery;
  /** The article opened from the list and the list's scroll position at that moment. */
  opened: { articleId: string; scrollY: number } | null;
  /** True once the reader's way back asks the list to restore that position. */
  restoring: boolean;
  /** An article the list loads batches up to and scrolls to. */
  reveal: string | null;
};

export const useArticleListStore = create<ArticleListState>(() => ({
  query: DEFAULT_ARTICLE_QUERY,
  opened: null,
  restoring: false,
  reveal: null,
}));

/** Remembers the article being opened and where the list was. */
export function rememberOpened(articleId: string): void {
  useArticleListStore.setState({ opened: { articleId, scrollY: window.scrollY } });
}

/** Asks the list to come back where it was when the article was opened. */
export function restoreListOnReturn(): void {
  useArticleListStore.setState({ restoring: true });
}

/** Asks the list to load and show an article, as a continuous play does between articles. */
export function revealInList(articleId: string | null): void {
  useArticleListStore.setState({ reveal: articleId, restoring: false });
}
