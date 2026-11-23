'use client';

// The browser side of the review endpoints (.docs/design/interfaces.md, 复习): the next question of
// a mode and submitting an answer. Each submit carries the operationId of the person's action:
// Retry sends the same one with the same answer again, a changed answer is a new operation.
import { z } from 'zod';
import { apiRequest, dataBody, isoTime } from '../../../lib/api/client.ts';
import type { ReviewableMode } from '../domain/schedule.ts';

const segmentSchema = z.union([
  z.object({ start: z.number().int(), text: z.string() }),
  z.object({ gap: z.literal(true) }),
]);

const head = { cardId: z.string(), nextRound: z.number().int(), pos: z.string() };

const spellSchema = z.object({
  ...head,
  mode: z.literal('spell'),
  meaningZh: z.string(),
  examples: z.array(z.object({ id: z.string(), segments: z.array(segmentSchema) })),
});

const optionSchema = z.object({ id: z.string(), pos: z.string(), meaningZh: z.string() });

const translateSchema = z.object({
  ...head,
  mode: z.literal('translate'),
  lemma: z.string(),
  examples: z.array(z.object({ id: z.string(), text: z.string() })),
  options: z.array(optionSchema),
});

const questionSchema = z.discriminatedUnion('mode', [spellSchema, translateSchema]);

export type SpellQuestion = z.infer<typeof spellSchema>;
export type TranslateQuestion = z.infer<typeof translateSchema>;
export type Question = z.infer<typeof questionSchema>;
export type TranslateOption = z.infer<typeof optionSchema>;

const nextSchema = z.object({ question: questionSchema.nullable(), nextDueAt: isoTime.nullable() });

export type NextQuestion = z.infer<typeof nextSchema>;

const resultSchema = z.object({
  result: z.enum(['correct', 'incorrect']),
  answer: z.string(),
  round: z.number().int(),
  dueAt: isoTime.nullable(),
});

export type SubmitResult = z.infer<typeof resultSchema>;

export type Answer = { text: string } | { optionId: string };

export const nextQuestionKey = (mode: ReviewableMode, visit: number) =>
  ['review', 'next', mode, visit] as const;

/** `GET /api/review/next?mode=…`. */
export async function requestNextQuestion(
  mode: ReviewableMode,
  signal?: AbortSignal,
): Promise<NextQuestion> {
  const { data } = await apiRequest(`/api/review/next?mode=${mode}`, dataBody(nextSchema), {
    signal,
  });
  return data;
}

export type Submission = {
  operationId: string;
  cardId: string;
  mode: ReviewableMode;
  answer: Answer;
};

/** `POST /api/review/submit`. */
export async function requestSubmit(submission: Submission): Promise<SubmitResult> {
  const { data } = await apiRequest('/api/review/submit', dataBody(resultSchema), {
    method: 'POST',
    body: submission,
  });
  return data;
}
