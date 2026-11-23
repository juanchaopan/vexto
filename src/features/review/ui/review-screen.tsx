'use client';

// A review (.docs/design/screens.md, 复习, screens 43–50, 63 and 71–72): one question at a time
// of the mode the person chose in Vocabulary. The top row holds the mode's name in small grey
// type and the close button, which goes back to Vocabulary as it was, with the focus on the
// mode's button; answers already sent stay, an answer not sent does not count. Each time the
// screen shows, whatever plays is paused (and stays paused afterwards) and a new question is
// asked. Below the top row is the question, or:
//   - `No reviews due.`, with `Next review in <time>.` when a question falls due later (48);
//   - `Couldn't load the next review.` with Retry when another try can help (71).
// An empty review asks again when the page gets the focus back; a question shown is never
// swapped for another while the person answers it.
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { offersRetry } from '../../../lib/api/client.ts';
import { formatTimeUntil } from '../../../lib/format/time-text.ts';
import { pauseAllAudio } from '../../../lib/ui/audio-focus.ts';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { useCloseTo } from '../../../lib/ui/navigation-history.tsx';
import { RetryStatus } from '../../../lib/ui/retry-status.tsx';
import { returnToVocabulary } from '../../../lib/ui/vocabulary-return.ts';
import type { ReviewableMode } from '../domain/schedule.ts';
import { nextQuestionKey, requestNextQuestion } from './review-api.ts';
import { ReviewQuestion } from './review-question.tsx';
import { beginReview, leaveReview, useSession } from './review-session.ts';

const VOCABULARY_PATH = '/vocabulary';
const LOAD_FAILED = "Couldn't load the next review.";

const MODE_NAMES: Record<ReviewableMode, string> = { spell: 'Spell', translate: 'Translate' };

/** The selector of the mode's button in Vocabulary, where the focus goes back to. */
export const modeButtonSelector = (mode: ReviewableMode) => `[data-review-mode="${mode}"]`;

/** How long until the next question, never `Due`: a question due by now is a moment away. */
function nextReviewText(nextDueAt: string): string {
  const text = formatTimeUntil(new Date(nextDueAt));
  return text === 'Due' ? '< 1 min' : text;
}

function useNextQuestion(mode: ReviewableMode) {
  const active = useSession(mode, (session) => session.active);
  const visit = useSession(mode, (session) => session.visit);
  return useQuery({
    queryKey: nextQuestionKey(mode, visit),
    queryFn: ({ signal }) => requestNextQuestion(mode, signal),
    enabled: active,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: (query) => (query.state.data?.question === null ? 'always' : false),
  });
}

function NoReviews({ nextDueAt }: { nextDueAt: string | null }) {
  return (
    <div role="status" className="grid flex-1 content-center gap-1 px-2.5 py-10 text-center">
      <p className="text-[15px] font-medium">No reviews due.</p>
      {nextDueAt ? (
        <p className="text-sm text-muted">Next review in {nextReviewText(nextDueAt)}.</p>
      ) : null}
    </div>
  );
}

export function ReviewScreen({ mode }: { mode: ReviewableMode }) {
  const close = useCloseTo(VOCABULARY_PATH);
  const next = useNextQuestion(mode);

  useLayoutEffect(() => {
    pauseAllAudio();
    beginReview(mode);
    return () => leaveReview(mode);
  }, [mode]);

  let body = null;
  if (next.data?.question) {
    body = (
      <ReviewQuestion key={next.data.question.cardId} mode={mode} question={next.data.question} />
    );
  } else if (next.data) {
    body = <NoReviews nextDueAt={next.data.nextDueAt} />;
  } else if (next.isError) {
    body = (
      <div className="mt-2 rounded-[5px] border border-line bg-surface px-3.5 py-[25px]">
        <RetryStatus
          message={LOAD_FAILED}
          onRetry={offersRetry(next.error) ? () => void next.refetch() : undefined}
        />
      </div>
    );
  }

  return (
    <main className="flex min-h-[calc(100dvh-70px)] flex-col px-[15px] pt-4 pb-[15px]">
      <div className="flex min-h-11 items-center justify-between gap-2.5 text-[11px] text-muted">
        <h1>{MODE_NAMES[mode]}</h1>
        <Button
          variant="flat"
          shape="icon"
          aria-label="Close review and return to Vocabulary"
          onClick={() => {
            returnToVocabulary(modeButtonSelector(mode));
            close();
          }}
        >
          <Icon name="x" />
        </Button>
      </div>
      {body}
    </main>
  );
}
