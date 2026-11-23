// Stand-ins for the component tests of the review screens: questions in the shapes the next
// question endpoint sends, answers of the submit endpoint, and routes for a fetch stand-in such
// as the vocabulary tests' standIn(). Only test files import this module.
import { useReviewCounts } from '../../../lib/ui/review-counts.ts';
import type { ReviewableMode } from '../domain/schedule.ts';
import type { SpellQuestion, SubmitResult, TranslateQuestion } from './review-api.ts';
import { ReviewScreen } from './review-screen.tsx';

export const MEANING = '有适应力的；能迅速恢复的';

/** A request the fetch stand-in saw. */
export type Sent = { method: string; path: string; body: unknown };

/** Answers a request, or leaves it to the next route. */
export type ReviewRoute = (request: Sent) => Response | undefined;

const answerJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** The Spell question of the confirmed screens: `resilient` hidden in two examples. */
export function spellQuestion(change: Partial<SpellQuestion> = {}): SpellQuestion {
  return {
    cardId: 'card-1',
    mode: 'spell',
    nextRound: 3,
    pos: 'adjective',
    meaningZh: MEANING,
    examples: [
      {
        id: 'example-1',
        segments: [
          { start: 0, text: 'A ' },
          { gap: true },
          { start: 11, text: ' city can adapt to unexpected challenges.' },
        ],
      },
      {
        id: 'example-2',
        segments: [
          { start: 0, text: 'She remained ' },
          { gap: true },
          { start: 22, text: ' during a difficult first year abroad.' },
        ],
      },
    ],
    ...change,
  };
}

/** The Translate question of the confirmed screens, the right option second. */
export function translateQuestion(change: Partial<TranslateQuestion> = {}): TranslateQuestion {
  return {
    cardId: 'card-1',
    mode: 'translate',
    nextRound: 3,
    lemma: 'resilient',
    pos: 'adjective',
    examples: [
      { id: 'example-1', text: 'A resilient city can adapt to unexpected challenges.' },
      { id: 'example-2', text: 'She remained resilient during a difficult first year abroad.' },
    ],
    options: [
      { id: 'option-1', pos: 'adjective', meaningZh: '持久的；持续很久的' },
      { id: 'option-2', pos: 'adjective', meaningZh: MEANING },
      { id: 'option-3', pos: 'adjective', meaningZh: '准确的；精确的' },
      { id: 'option-4', pos: 'adjective', meaningZh: '脆弱的；易受损的' },
    ],
    ...change,
  };
}

export const questionAnswer = (question: SpellQuestion | TranslateQuestion) =>
  answerJson(200, { data: { question, nextDueAt: null } });

export const noQuestionAnswer = (nextDueAt: string | null) =>
  answerJson(200, { data: { question: null, nextDueAt } });

/** A judged answer; right at round 3 by default. */
export const resultAnswer = (change: Partial<SubmitResult> = {}) =>
  answerJson(200, {
    data: { result: 'correct', answer: 'resilient', round: 3, dueAt: null, ...change },
  });

/** Answers the next question requests in turn with these answers; the last one repeats. */
export function nextRoute(...answers: (() => Response)[]): ReviewRoute {
  let asked = 0;
  return (request) => {
    if (request.path !== '/api/review/next') {
      return undefined;
    }
    const answer = answers[Math.min(asked, answers.length - 1)];
    asked += 1;
    return answer();
  };
}

/** Answers the submits with `answer`. */
export function submitRoute(answer: (request: Sent) => Response): ReviewRoute {
  return (request) => (request.path === '/api/review/submit' ? answer(request) : undefined);
}

export const submits = (sent: Sent[]) =>
  sent.filter((request) => request.path === '/api/review/submit');

export const nextRequests = (sent: Sent[]) =>
  sent.filter((request) => request.path === '/api/review/next');

export const countRequests = (sent: Sent[]) =>
  sent.filter((request) => request.path === '/api/review/counts');

/** A failed request that got no response, as when the device is offline. */
export function noResponse(): Response {
  throw new TypeError('Failed to fetch');
}

/** Reads the review counts the way the top bar does, so a test sees them asked for again. */
function CountsReader() {
  useReviewCounts();
  return null;
}

/** The review screen of a mode with a reader of the counts beside it. */
export function reviewPage(mode: ReviewableMode) {
  return (
    <>
      <ReviewScreen mode={mode} />
      <CountsReader />
    </>
  );
}
