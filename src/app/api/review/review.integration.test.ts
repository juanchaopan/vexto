// The review endpoints against PostgreSQL (.docs/design/rules.md, 间隔复习 and 并发和多设备): the
// counts; which question comes next in each mode and what it holds; how a right, a wrong and a
// final answer move the round and the due time with the database's time; a repeated submit
// answered from its receipt; two devices answering the same question at once; a question that is
// not open; a card deleted or replaced meanwhile; and archiving once all three modes complete.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { signInAsMember } from '../../../features/account/testing.ts';
import { insertReviewCard, minutesFromNow, uniqueWord } from '../../../features/review/testing.ts';
import { cardRows, setProgress } from '../../../features/vocabulary/testing.ts';
import { expectApiError, readSuccess } from '../../../lib/api/testing.ts';
import { closeDatabase } from '../../../lib/db/client.ts';
import { GET as listCards } from '../vocabulary/route.ts';
import {
  choice,
  nextRequest,
  readCounts,
  readNext,
  readSubmit,
  spelling,
  submitRequest,
} from './testing.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../features/account/testing.ts')).nextServerStandIn(),
);

beforeAll(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

const HOUR = 60;
const DAY_MS = 24 * 60 * 60_000;

async function progressOf(cardId: string, mode: string) {
  const { progress } = await cardRows(cardId);
  const row = progress.find((one) => one.mode === mode);
  return { round: row?.round, dueAt: row?.dueAt ?? null };
}

/** How far a time lies from now plus `ms`, in milliseconds. */
function offFrom(time: string | Date | null, ms: number): number {
  return Math.abs(new Date(time ?? 0).getTime() - (Date.now() + ms));
}

async function stateOf(cardId: string, lemma: string): Promise<string[]> {
  const states = [];
  for (const state of ['new', 'ongoing', 'archived']) {
    const response = await listCards(
      new Request(`http://localhost:3000/api/vocabulary?state=${state}&q=${lemma}`),
    );
    const body = (await readSuccess(response)) as { data: { id: string }[] };
    if (body.data.some((card) => card.id === cardId)) {
      states.push(state);
    }
  }
  return states;
}

describe('the review counts', () => {
  it('count due questions and new words of Spell and Translate, never Speak', async () => {
    const member = await signInAsMember();
    await insertReviewCard(member.id, {
      progress: {
        spell: { round: 2, dueAt: minutesFromNow(-HOUR) },
        speak: { round: 1, dueAt: minutesFromNow(-HOUR) },
      },
    });
    await insertReviewCard(member.id);
    await insertReviewCard(member.id, {
      progress: {
        spell: { round: 3, dueAt: minutesFromNow(4 * HOUR) },
        translate: { round: 7, dueAt: null },
      },
    });
    await insertReviewCard(member.id, {
      progress: {
        spell: { round: 0, dueAt: minutesFromNow(10) },
        translate: { round: 1, dueAt: minutesFromNow(-1) },
      },
    });

    expect(await readCounts()).toEqual({
      spell: { due: 1, new: 1 },
      translate: { due: 1, new: 2 },
    });
  });

  it('are zero for an empty vocabulary', async () => {
    await signInAsMember();

    expect(await readCounts()).toEqual({
      spell: { due: 0, new: 0 },
      translate: { due: 0, new: 0 },
    });
  });
});

describe('the next question', () => {
  it('is the earliest due card first, then the oldest new word', async () => {
    const member = await signInAsMember();
    const older = await insertReviewCard(member.id, { createdAt: new Date('2026-01-01') });
    const newer = await insertReviewCard(member.id, { createdAt: new Date('2026-02-01') });
    const later = await insertReviewCard(member.id, {
      progress: { spell: { round: 1, dueAt: minutesFromNow(-10) } },
    });
    const earlier = await insertReviewCard(member.id, {
      progress: { spell: { round: 4, dueAt: minutesFromNow(-3 * HOUR) } },
    });

    const order = [];
    for (let index = 0; index < 4; index += 1) {
      const { question } = await readNext('spell');
      order.push(question?.cardId);
      await readSubmit(spelling(question?.cardId ?? '', 'wrong'));
    }

    expect(order).toEqual([earlier.id, later.id, older.id, newer.id]);
  });

  it('asks Spell with the meaning, the part of speech and the examples around a gap', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id, {
      lemma: 'run',
      pos: 'verb',
      meaningZh: '跑；奔跑',
      acceptedForms: ['run', 'ran', 'running'],
      examples: ['She ran home and kept running.', 'They run every morning before work.'],
      progress: { spell: { round: 2, dueAt: minutesFromNow(-1) } },
    });

    const { question, nextDueAt } = await readNext('spell');

    expect(nextDueAt).toBeNull();
    expect(question).toEqual({
      cardId: card.id,
      mode: 'spell',
      nextRound: 3,
      pos: 'verb',
      meaningZh: '跑；奔跑',
      examples: [
        {
          id: card.examples[0].id,
          segments: [
            { start: 0, text: 'She ' },
            { gap: true },
            { start: 7, text: ' home and kept ' },
            { gap: true },
            { start: 29, text: '.' },
          ],
        },
        {
          id: card.examples[1].id,
          segments: [
            { start: 0, text: 'They ' },
            { gap: true },
            { start: 8, text: ' every morning before work.' },
          ],
        },
      ],
    });
    expect(JSON.stringify(question)).not.toMatch(/\b(run|ran|running)\b/i);
  });

  it('asks Translate with the lemma, the examples and the options in their order', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id);

    const { question } = await readNext('translate');

    expect(question).toEqual({
      cardId: card.id,
      mode: 'translate',
      nextRound: 1,
      lemma: card.lemma,
      pos: 'adjective',
      examples: card.examples.map((example) => ({ id: example.id, text: example.text })),
      options: card.options,
    });
    expect(JSON.stringify(question)).not.toContain('correct');
  });

  it('is none, with when the next falls due, when nothing can be asked', async () => {
    const member = await signInAsMember();
    await insertReviewCard(member.id, {
      progress: { spell: { round: 3, dueAt: minutesFromNow(4 * HOUR) } },
    });
    await insertReviewCard(member.id, {
      progress: { spell: { round: 1, dueAt: minutesFromNow(2 * HOUR) } },
    });
    await insertReviewCard(member.id, { progress: { spell: { round: 7, dueAt: null } } });

    const { question, nextDueAt } = await readNext('spell');

    expect(question).toBeNull();
    expect(offFrom(nextDueAt, 2 * HOUR * 60_000)).toBeLessThan(60_000);
  });

  it('is none with no next due time when every mode is complete or the vocabulary empty', async () => {
    const member = await signInAsMember();

    expect(await readNext('translate')).toEqual({ question: null, nextDueAt: null });
    await insertReviewCard(member.id, { progress: { translate: { round: 7, dueAt: null } } });
    expect(await readNext('translate')).toEqual({ question: null, nextDueAt: null });
  });

  it('refuses another mode', async () => {
    await signInAsMember();

    await expectApiError(await nextRequest('mode=speak'), 'INVALID_INPUT');
    await expectApiError(await nextRequest(''), 'INVALID_INPUT');
  });
});

describe('submitting an answer', () => {
  it('moves a right Spell answer one round on with its wait', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id, {
      lemma: 'Resilient',
      acceptedForms: ['Resilient', 'resiliently'],
      progress: { spell: { round: 2, dueAt: minutesFromNow(-HOUR) } },
    });

    const result = await readSubmit(spelling(card.id, '  resilient '));

    expect(result).toMatchObject({ result: 'correct', answer: 'Resilient', round: 3 });
    expect(offFrom(result.dueAt, 4 * DAY_MS)).toBeLessThan(60_000);
    const progress = await progressOf(card.id, 'spell');
    expect(progress.round).toBe(3);
    expect(progress.dueAt?.toISOString()).toBe(result.dueAt);
    expect(await readCounts()).toEqual({
      spell: { due: 0, new: 0 },
      translate: { due: 0, new: 1 },
    });
  });

  it('moves a wrong answer one round back and asks again in 10 minutes', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id, {
      lemma: 'resilient',
      progress: { spell: { round: 2, dueAt: minutesFromNow(-HOUR) } },
    });

    const result = await readSubmit(spelling(card.id, 'resiliant'));

    expect(result).toMatchObject({ result: 'incorrect', answer: 'resilient', round: 1 });
    expect(offFrom(result.dueAt, 10 * 60_000)).toBeLessThan(60_000);
    expect((await readNext('spell')).question).toBeNull();
  });

  it('keeps a new word at round 0 after a wrong answer, no longer new', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id);

    const result = await readSubmit(choice(card.id, card.options[0].id));

    expect(result).toMatchObject({ result: 'incorrect', answer: card.meaningZh, round: 0 });
    expect(await readCounts()).toMatchObject({ translate: { due: 0, new: 0 } });
    expect(await stateOf(card.id, card.lemma)).toEqual(['ongoing']);
  });

  it('judges a Translate answer by the chosen option', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id);

    const result = await readSubmit(choice(card.id, card.correctOptionId));

    expect(result).toMatchObject({ result: 'correct', answer: card.meaningZh, round: 1 });
    expect(offFrom(result.dueAt, DAY_MS)).toBeLessThan(60_000);
  });

  it('completes the mode with the right answer at round 6', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id, {
      progress: { translate: { round: 6, dueAt: minutesFromNow(-1) } },
    });

    const result = await readSubmit(choice(card.id, card.correctOptionId));

    expect(result).toMatchObject({ result: 'correct', round: 7, dueAt: null });
    expect(await progressOf(card.id, 'translate')).toEqual({ round: 7, dueAt: null });
  });

  it('refuses a question not due yet or complete with CONFLICT and changes nothing', async () => {
    const member = await signInAsMember();
    const later = minutesFromNow(HOUR);
    const card = await insertReviewCard(member.id, {
      progress: { spell: { round: 3, dueAt: later }, translate: { round: 7, dueAt: null } },
    });

    await expectApiError(await submitRequest(spelling(card.id, card.lemma)), 'CONFLICT');
    await expectApiError(await submitRequest(choice(card.id, card.correctOptionId)), 'CONFLICT');
    expect(await progressOf(card.id, 'spell')).toEqual({ round: 3, dueAt: later });
    expect(await progressOf(card.id, 'translate')).toEqual({ round: 7, dueAt: null });
  });

  it('answers a repeated submit from its receipt and moves the round once', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id, {
      progress: { spell: { round: 1, dueAt: minutesFromNow(-1) } },
    });
    const body = spelling(card.id, card.lemma);

    const first = await readSubmit(body);
    const again = await readSubmit(body);

    expect(again).toEqual(first);
    expect((await progressOf(card.id, 'spell')).round).toBe(2);
    await expectApiError(
      await submitRequest({ ...body, answer: { text: 'other' } }),
      'OPERATION_MISMATCH',
    );
  });

  it('lets one of two devices answering at once move the round; the other gets CONFLICT', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id, {
      progress: { spell: { round: 4, dueAt: minutesFromNow(-1) } },
    });

    const responses = await Promise.all([
      submitRequest(spelling(card.id, card.lemma)),
      submitRequest(spelling(card.id, 'wrong')),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const round = (await progressOf(card.id, 'spell')).round;
    expect([3, 5]).toContain(round);
  });

  it('answers a deleted card with 404', async () => {
    await signInAsMember();

    const response = await submitRequest(spelling(randomUUID(), 'resilient'));

    await expectApiError(response, 'NOT_FOUND');
  });

  it('answers an option the card no longer has with CONFLICT', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id);

    await expectApiError(await submitRequest(choice(card.id, randomUUID())), 'CONFLICT');
    expect(await progressOf(card.id, 'translate')).toEqual({ round: 0, dueAt: null });
  });
});

describe('archiving', () => {
  it('happens once Speak, Spell and Translate are all complete', async () => {
    const member = await signInAsMember();
    const lemma = uniqueWord();
    const card = await insertReviewCard(member.id, {
      lemma,
      progress: {
        spell: { round: 7, dueAt: null },
        translate: { round: 6, dueAt: minutesFromNow(-1) },
      },
    });
    await setProgress(member.id, card.id, 'speak', 7, null);

    await readSubmit(choice(card.id, card.correctOptionId));

    expect(await stateOf(card.id, lemma)).toEqual(['archived']);
  });

  it('never happens while Speak is not complete, as in this version', async () => {
    const member = await signInAsMember();
    const lemma = uniqueWord();
    const card = await insertReviewCard(member.id, {
      lemma,
      progress: {
        spell: { round: 7, dueAt: null },
        translate: { round: 6, dueAt: minutesFromNow(-1) },
      },
    });

    await readSubmit(choice(card.id, card.correctOptionId));

    expect(await stateOf(card.id, lemma)).toEqual(['ongoing']);
  });
});
