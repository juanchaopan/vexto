'use client';

// Connects the article player to the pages of the shell: a continuous play moves between the list
// and the reader through the router, logging out stops playback and forgets the audio, and coming
// back to the foreground during a continuous play shows the article that plays now, which may
// have changed while the page was hidden (.docs/design/rules.md, 文章列表、搜索和播放).
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { onSignOut } from '../../../lib/ui/sign-out-cleanup.ts';
import { revealInList } from './article-list-store.ts';
import { connectPlayer, reset } from './player.ts';
import { usePlayerStore } from './player-store.ts';

export const ARTICLES_PATH = '/';

export function readerPath(articleId: string): string {
  return `/articles/${encodeURIComponent(articleId)}`;
}

export function PlayerHost() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  useEffect(
    () =>
      connectPlayer({
        queryClient,
        navigator: {
          isForeground: () => document.visibilityState === 'visible',
          showList: (reveal) => {
            revealInList(reveal);
            router.push(ARTICLES_PATH);
          },
          openArticle: (id) => router.push(readerPath(id)),
        },
      }),
    [queryClient, router],
  );

  useEffect(() => onSignOut(reset), []);

  useEffect(() => {
    const onVisible = () => {
      const { article, queue, status } = usePlayerStore.getState();
      if (document.visibilityState !== 'visible' || !article || !queue || status === 'idle') {
        return;
      }
      const playing = readerPath(article.id);
      if (path.current !== playing) {
        router.replace(playing);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router]);

  return null;
}
