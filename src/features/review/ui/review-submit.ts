'use client';

// Submitting an answer (.docs/design/screens.md, 复习 and 错误的显示). An empty answer is not sent:
// `Enter your answer.` or `Select an option.` says what is missing. A sent answer gets a new
// operationId; then:
//   - judged: the result row, and the answer stays read-only;
//   - no response: the answer stays read-only with `Not saved. Reconnect to check the result.`,
//     and Retry sends the same operation again, which tells whether the first one was saved;
//   - CONFLICT: the question was answered on another device or its card changed, said in the
//     yellow row `This word changed on another device.`;
//   - NOT_FOUND: the card was deleted, `This word was deleted.`, and the next question comes;
//   - another failure: the server saved nothing, so the answer can be changed again, and
//     `Couldn't save your answer.` offers Retry with the same answer when another try can help.
// Whatever may have changed the progress asks for the review counts again and drops the loaded
// Vocabulary lists and cards, whose rounds and due times are no longer right. A submit that ends
// after the person moved on to another question changes nothing on screen.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { hasErrorCode, offersRetry } from '../../../lib/api/client.ts';
import { refreshReviewCounts } from '../../../lib/ui/review-counts.ts';
import { showToast } from '../../../lib/ui/toast.tsx';
import type { ReviewableMode } from '../domain/schedule.ts';
import { requestSubmit, type Answer, type Question, type Submission } from './review-api.ts';
import { answerOf, askNext, isLocked, sessionOf } from './review-session.ts';

export const ENTER_ANSWER = 'Enter your answer.';
export const SELECT_OPTION = 'Select an option.';
export const SUBMIT_FAILED = "Couldn't save your answer.";
export const DELETED = 'This word was deleted.';

function progressChanged(queryClient: QueryClient) {
  refreshReviewCounts(queryClient);
  queryClient.removeQueries({ queryKey: ['vocabulary'] });
}

function answerOfSession(mode: ReviewableMode, question: Question): Answer | null {
  const { text, optionId } = sessionOf(mode).getState();
  if (question.mode === 'spell') {
    return text.trim() === '' ? null : { text };
  }
  return optionId === null ? null : { optionId };
}

export type Answering = {
  /** Sends the answer written or chosen, or says what is missing. */
  submit(): void;
  /** Sends the last submit again, as it was. */
  retry(): void;
};

export function useAnswering(mode: ReviewableMode, question: Question): Answering {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({ mutationFn: requestSubmit });
  const session = sessionOf(mode);

  const failed = (error: unknown, submission: Submission, again: () => void) => {
    if (hasErrorCode(error, 'NO_RESPONSE')) {
      session.setState({ sending: false, outcome: { kind: 'offline' } });
    } else if (hasErrorCode(error, 'CONFLICT')) {
      progressChanged(queryClient);
      session.setState({ sending: false, outcome: { kind: 'changed' } });
    } else if (hasErrorCode(error, 'NOT_FOUND')) {
      progressChanged(queryClient);
      showToast(DELETED);
      askNext(mode);
    } else {
      session.setState({ sending: false, outcome: null, ...answerOf(submission) });
      showToast(SUBMIT_FAILED, offersRetry(error) ? { retry: again } : {});
    }
  };

  const send = async (submission: Submission): Promise<void> => {
    const visit = session.getState().visit;
    const current = () => session.getState().visit === visit;
    session.setState({ sending: true, sent: submission, outcome: null, ...answerOf(submission) });
    try {
      const result = await mutateAsync(submission);
      progressChanged(queryClient);
      if (current()) {
        session.setState({ sending: false, outcome: { kind: 'answered', result } });
      }
    } catch (error) {
      if (current()) {
        failed(error, submission, () => {
          if (current() && !session.getState().sending) {
            void send(submission);
          }
        });
      }
    }
  };

  return {
    submit() {
      if (isLocked(session.getState())) {
        return;
      }
      const answer = answerOfSession(mode, question);
      if (!answer) {
        showToast(question.mode === 'spell' ? ENTER_ANSWER : SELECT_OPTION);
        return;
      }
      void send({ operationId: crypto.randomUUID(), cardId: question.cardId, mode, answer });
    },
    retry() {
      const { sent, sending } = session.getState();
      if (sent && !sending) {
        void send(sent);
      }
    },
  };
}
