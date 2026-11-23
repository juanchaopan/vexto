// Requests to the review endpoints the way a browser sends them, for the integration and security
// tests of the reviews. Only test files import this module.
import { randomUUID } from 'node:crypto';
import { jsonRequest, readSuccess } from '../../../lib/api/testing.ts';
import { GET as getCounts } from './counts/route.ts';
import { GET as getNext } from './next/route.ts';
import { POST as postSubmit } from './submit/route.ts';

export type ModeCounts = { due: number; new: number };
export type Counts = { spell: ModeCounts; translate: ModeCounts };

export type Segment = { start: number; text: string } | { gap: true };

export type QuestionBody = {
  cardId: string;
  mode: string;
  nextRound: number;
  pos: string;
  meaningZh?: string;
  lemma?: string;
  examples: { id: string; segments?: Segment[]; text?: string }[];
  options?: { id: string; pos: string; meaningZh: string }[];
};

export type NextBody = { question: QuestionBody | null; nextDueAt: string | null };

export type SubmitBody = {
  result: 'correct' | 'incorrect';
  answer: string;
  round: number;
  dueAt: string | null;
};

export function countsRequest(): Promise<Response> {
  return getCounts();
}

export function nextRequest(query: string): Promise<Response> {
  return getNext(new Request(`http://localhost:3000/api/review/next?${query}`));
}

export function submitRequest(body: unknown): Promise<Response> {
  return postSubmit(jsonRequest('/api/review/submit', body));
}

export async function readCounts(): Promise<Counts> {
  return ((await readSuccess(await countsRequest())) as { data: Counts }).data;
}

export async function readNext(mode: string): Promise<NextBody> {
  return ((await readSuccess(await nextRequest(`mode=${mode}`))) as { data: NextBody }).data;
}

/** The body of a Spell answer. */
export function spelling(cardId: string, text: string, operationId = randomUUID()) {
  return { operationId, cardId, mode: 'spell', answer: { text } };
}

/** The body of a Translate answer. */
export function choice(cardId: string, optionId: string, operationId = randomUUID()) {
  return { operationId, cardId, mode: 'translate', answer: { optionId } };
}

export async function readSubmit(body: unknown): Promise<SubmitBody> {
  return ((await readSuccess(await submitRequest(body))) as { data: SubmitBody }).data;
}
