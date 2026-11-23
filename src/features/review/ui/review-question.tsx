'use client';

// One review question with its answer (.docs/design/screens.md, 复习的共同部分 and screens 43–50,
// 63, 72): the prompt of its mode, the result row once the answer is sent, and the bottom row
// with `Round <n>`, the round a right answer reaches, and the main button: `Submit →` while
// answering, `Next →` once the outcome is known, and `Retry` while the answer is unsaved for lack
// of a response. The result rows:
//   - right: `Correct · Next review in <time>`, or `Correct · Complete` on reaching the last round;
//   - wrong: `<right answer> · Try again in 10 mins`;
//   - no response: `Not saved. Reconnect to check the result.` in red;
//   - changed elsewhere: `This word changed on another device.` in yellow.
// Return on the keyboard submits as the Submit button does.
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import {
  COMPLETE_ROUND,
  RETRY_WAIT_MINUTES,
  waitToReach,
  type ReviewableMode,
  type Wait,
} from '../domain/schedule.ts';
import type { Question } from './review-api.ts';
import { askNext, useSession, type Outcome } from './review-session.ts';
import { useAnswering } from './review-submit.ts';
import { SpellPrompt } from './spell-prompt.tsx';
import { TranslatePrompt } from './translate-prompt.tsx';

export const NOT_SAVED = 'Not saved. Reconnect to check the result.';
export const CHANGED = 'This word changed on another device.';

/** A wait as the result row says it: `4 days`, `1 day`, `10 mins`. */
export function waitText(wait: Wait): string {
  const unit = wait.unit === 'day' ? 'day' : 'min';
  return `${wait.amount} ${unit}${wait.amount === 1 ? '' : 's'}`;
}

type Row = { tone: 'plain' | 'error' | 'warn'; text: string };

/** What the result row says about an outcome. */
export function resultRow(outcome: Outcome): Row {
  if (outcome.kind === 'offline') {
    return { tone: 'error', text: NOT_SAVED };
  }
  if (outcome.kind === 'changed') {
    return { tone: 'warn', text: CHANGED };
  }
  const { result } = outcome;
  if (result.result === 'incorrect') {
    const wait = waitText({ unit: 'minute', amount: RETRY_WAIT_MINUTES });
    return { tone: 'plain', text: `${result.answer} · Try again in ${wait}` };
  }
  const wait = waitToReach(result.round);
  return {
    tone: 'plain',
    text:
      result.round >= COMPLETE_ROUND || !wait
        ? 'Correct · Complete'
        : `Correct · Next review in ${waitText(wait)}`,
  };
}

const tones: Record<Row['tone'], string> = {
  plain: 'bg-soft',
  error: 'bg-[color-mix(in_srgb,var(--color-danger)_10%,var(--color-surface))] text-danger',
  warn: 'bg-[color-mix(in_srgb,var(--color-warning)_12%,var(--color-surface))] text-warning',
};

function ResultRow({ mode }: { mode: ReviewableMode }) {
  const outcome = useSession(mode, (session) => session.outcome);
  const row = outcome ? resultRow(outcome) : null;
  return (
    <div role="status" className="mt-[13px] min-h-0 empty:hidden">
      {row ? (
        <p className={`rounded px-[11px] py-[9px] text-xs ${tones[row.tone]}`}>{row.text}</p>
      ) : null}
    </div>
  );
}

function MainButton({ mode, retry }: { mode: ReviewableMode; retry: () => void }) {
  const outcome = useSession(mode, (session) => session.outcome);
  const sending = useSession(mode, (session) => session.sending);
  const wide = 'min-w-[90px]';
  if (outcome?.kind === 'offline') {
    return (
      <Button variant="primary" className={wide} disabled={sending} onClick={retry}>
        <Icon name={sending ? 'loader-circle' : 'refresh-cw'} spin={sending} />
        Retry
      </Button>
    );
  }
  if (outcome) {
    return (
      <Button variant="primary" className={wide} onClick={() => askNext(mode)}>
        Next
        <Icon name="arrow-right" />
      </Button>
    );
  }
  return (
    <Button
      type="submit"
      variant="primary"
      className={wide}
      disabled={sending}
      aria-busy={sending || undefined}
    >
      Submit
      <Icon name={sending ? 'loader-circle' : 'arrow-right'} spin={sending} />
    </Button>
  );
}

export function ReviewQuestion({ mode, question }: { mode: ReviewableMode; question: Question }) {
  const answering = useAnswering(mode, question);
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        answering.submit();
      }}
    >
      <div className="flex-1 px-[3px] pt-2">
        {question.mode === 'spell' ? (
          <SpellPrompt question={question} />
        ) : (
          <TranslatePrompt question={question} />
        )}
        <ResultRow mode={mode} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2.5 border-t border-line pt-2.5">
        <span className="text-[11px] whitespace-nowrap text-muted">Round {question.nextRound}</span>
        <MainButton mode={mode} retry={answering.retry} />
      </div>
    </form>
  );
}
