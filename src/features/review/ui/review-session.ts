'use client';

// The state of a review while it shows (.docs/design/screens.md, 复习): which question this visit
// asks, the example shown, the answer being written or chosen, the submit on its way and how the
// answer came out. Each mode has a session of its own. The screen may be kept while hidden and
// shown again, so a session begins each time its screen shows and asks for a new question then;
// pressing Next asks for the next one the same way. Changing the example keeps the answer.
import { createStore, useStore, type StoreApi } from 'zustand';
import type { ReviewableMode } from '../domain/schedule.ts';
import type { Submission, SubmitResult } from './review-api.ts';

/** How a submitted answer came out, as the result row shows it. */
export type Outcome =
  | { kind: 'answered'; result: SubmitResult }
  /** The question was answered on another device, or its card changed meanwhile. */
  | { kind: 'changed' }
  /** No response: whether the answer was saved is unknown until it is sent again. */
  | { kind: 'offline' };

export type ReviewSession = {
  /** Whether the screen shows; no question is asked while it is hidden. */
  active: boolean;
  /** Counts the questions asked, so each one is fetched afresh. */
  visit: number;
  exampleIndex: number;
  text: string;
  optionId: string | null;
  sending: boolean;
  /** The last submit sent, which Retry sends again as it is. */
  sent: Submission | null;
  outcome: Outcome | null;
};

const unanswered = {
  exampleIndex: 0,
  text: '',
  optionId: null,
  sending: false,
  sent: null,
  outcome: null,
} satisfies Partial<ReviewSession>;

function newSession(): StoreApi<ReviewSession> {
  return createStore<ReviewSession>(() => ({ active: false, visit: 0, ...unanswered }));
}

const sessions: Record<ReviewableMode, StoreApi<ReviewSession>> = {
  spell: newSession(),
  translate: newSession(),
};

export function sessionOf(mode: ReviewableMode): StoreApi<ReviewSession> {
  return sessions[mode];
}

export function useSession<T>(mode: ReviewableMode, select: (session: ReviewSession) => T): T {
  return useStore(sessions[mode], select);
}

/** The screen shows: a new question is asked. */
export function beginReview(mode: ReviewableMode): void {
  sessions[mode].setState((session) => ({
    active: true,
    visit: session.visit + 1,
    ...unanswered,
  }));
}

/** The screen is hidden or gone. */
export function leaveReview(mode: ReviewableMode): void {
  sessions[mode].setState({ active: false });
}

/** Asks for the next question. */
export function askNext(mode: ReviewableMode): void {
  sessions[mode].setState((session) => ({ visit: session.visit + 1, ...unanswered }));
}

export function showExample(mode: ReviewableMode, index: number): void {
  sessions[mode].setState({ exampleIndex: index });
}

export function writeAnswer(mode: ReviewableMode, text: string): void {
  sessions[mode].setState({ text });
}

export function chooseOption(mode: ReviewableMode, optionId: string): void {
  sessions[mode].setState({ optionId });
}

/** Whether the answer can no longer be changed: on its way, or its outcome is known. */
export function isLocked(session: Pick<ReviewSession, 'sending' | 'outcome'>): boolean {
  return session.sending || session.outcome !== null;
}

/** Puts back the answer a submit sent, so Retry shows what it sends again. */
export function answerOf(submission: Submission): Partial<ReviewSession> {
  return 'text' in submission.answer
    ? { text: submission.answer.text }
    : { optionId: submission.answer.optionId };
}
