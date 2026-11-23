'use client';

// The review counts (.docs/design/rules.md, 计数): for Spell and Translate, how many questions are
// due and how many are new words. The top bar's Vocabulary button shows them added together and
// the Vocabulary screen's mode buttons show each mode's; every change to the vocabulary (saving,
// replacing, deleting) and every submitted answer asks for them again. A failure shows nothing
// new and keeps the counts already on screen (.docs/design/screens.md, 错误的显示).
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, dataBody } from '../api/client.ts';

const modeCounts = z.object({ due: z.number().int(), new: z.number().int() });

const countsSchema = z.object({ spell: modeCounts, translate: modeCounts });

export type ModeCounts = z.infer<typeof modeCounts>;

export type ReviewCounts = z.infer<typeof countsSchema>;

export const REVIEW_COUNTS_KEY = ['review', 'counts'] as const;

/** The counts of `GET /api/review/counts`, or undefined until they are first known. */
export function useReviewCounts(): ReviewCounts | undefined {
  const counts = useQuery({
    queryKey: REVIEW_COUNTS_KEY,
    queryFn: async ({ signal }) =>
      (await apiRequest('/api/review/counts', dataBody(countsSchema), { signal })).data,
    staleTime: 0,
  });
  return counts.data;
}

/** Asks for the counts again, as after a change to the vocabulary or an answer. */
export function refreshReviewCounts(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: REVIEW_COUNTS_KEY });
}
