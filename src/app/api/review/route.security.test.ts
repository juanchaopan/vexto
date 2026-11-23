// The reviews and hostile input (.docs/design/rules.md, 权限和数据隔离, 间隔复习 and Spell): only
// signed-in members who accepted the terms reach the endpoints; another member's card is the
// same 404 as one that does not exist, is never asked and never counted; a made-up card ID, an
// answer that names another card's option, a round sent along or a mode without questions
// changes nothing; and a Spell question never gives away the hidden word in any of its forms.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  actAsClerkUser,
  signInAsMember,
  signInToClerk,
  signOutOfClerk,
  uniqueEmail,
} from '../../../features/account/testing.ts';
import { insertReviewCard, minutesFromNow } from '../../../features/review/testing.ts';
import { cardRows } from '../../../features/vocabulary/testing.ts';
import { expectApiError, expectNotFound } from '../../../lib/api/testing.ts';
import { closeDatabase } from '../../../lib/db/client.ts';
import {
  choice,
  countsRequest,
  nextRequest,
  readCounts,
  readNext,
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

const due = () => ({ round: 2, dueAt: minutesFromNow(-60) });

async function progressRows(cardId: string) {
  return (await cardRows(cardId)).progress.map(({ mode, round, dueAt }) => ({
    mode,
    round,
    dueAt,
  }));
}

/** A member with a due card, then a second member with nothing, signed in as the second. */
async function intruderAndCard() {
  const owner = await signInAsMember();
  const card = await insertReviewCard(owner.id, { progress: { spell: due(), translate: due() } });
  const intruder = await signInAsMember();
  actAsClerkUser(intruder.clerkUserId);
  return { card };
}

async function everyEndpointAnswers(code: 'UNAUTHENTICATED' | 'TERMS_REQUIRED' | 'NOT_A_MEMBER') {
  await expectApiError(await countsRequest(), code);
  await expectApiError(await nextRequest('mode=spell'), code);
  await expectApiError(await submitRequest(spelling(randomUUID(), 'resilient')), code);
}

describe('the review endpoints', () => {
  it('answer a signed-out request with 401', async () => {
    signOutOfClerk();

    await everyEndpointAnswers('UNAUTHENTICATED');
  });

  it('answer a member who has not accepted the terms with 403 and change nothing', async () => {
    const member = await signInAsMember({ termsVersion: null });
    const card = await insertReviewCard(member.id, { progress: { spell: due() } });
    const before = await progressRows(card.id);

    await everyEndpointAnswers('TERMS_REQUIRED');
    await expectApiError(await submitRequest(spelling(card.id, card.lemma)), 'TERMS_REQUIRED');
    expect(await progressRows(card.id)).toEqual(before);
  });

  it('answer someone who is not on the member list with 403', async () => {
    signInToClerk([{ address: uniqueEmail('outsider') }]);

    await everyEndpointAnswers('NOT_A_MEMBER');
  });

  it('never ask or count another member’s card', async () => {
    await intruderAndCard();

    expect(await readNext('spell')).toEqual({ question: null, nextDueAt: null });
    expect(await readNext('translate')).toEqual({ question: null, nextDueAt: null });
    expect(await readCounts()).toEqual({
      spell: { due: 0, new: 0 },
      translate: { due: 0, new: 0 },
    });
  });

  it('answer a submit for another member’s card with 404 and leave its progress', async () => {
    const { card } = await intruderAndCard();
    const before = await progressRows(card.id);

    await expectNotFound(await submitRequest(spelling(card.id, card.lemma)));
    await expectNotFound(await submitRequest(choice(card.id, card.correctOptionId)));
    expect(await progressRows(card.id)).toEqual(before);
  });

  it('answer a made-up card ID with 404, and one that is not a UUID as invalid input', async () => {
    await signInAsMember();

    await expectNotFound(await submitRequest(spelling(randomUUID(), 'resilient')));
    await expectApiError(
      await submitRequest(spelling("1' or '1'='1", 'resilient')),
      'INVALID_INPUT',
    );
  });

  it('refuse an option of another card of the member’s and change nothing', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id, { progress: { translate: due() } });
    const other = await insertReviewCard(member.id);
    const before = await progressRows(card.id);

    await expectApiError(await submitRequest(choice(card.id, other.correctOptionId)), 'CONFLICT');
    expect(await progressRows(card.id)).toEqual(before);
  });

  it('refuse a round sent along, a mode without questions and an answer of the wrong kind', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id, { progress: { spell: due() } });
    const before = await progressRows(card.id);
    const body = spelling(card.id, card.lemma);

    await expectApiError(await submitRequest({ ...body, round: 6 }), 'INVALID_INPUT');
    await expectApiError(await submitRequest({ ...body, mode: 'speak' }), 'INVALID_INPUT');
    await expectApiError(
      await submitRequest({ ...body, answer: { optionId: card.correctOptionId } }),
      'INVALID_INPUT',
    );
    await expectApiError(
      await submitRequest({ ...body, answer: { text: card.lemma, correct: true } }),
      'INVALID_INPUT',
    );
    await expectApiError(
      await submitRequest({ ...body, answer: { text: 'x'.repeat(81) } }),
      'INVALID_INPUT',
    );
    expect(await progressRows(card.id)).toEqual(before);
  });

  it('take a hostile answer as text only', async () => {
    const member = await signInAsMember();
    const card = await insertReviewCard(member.id, { progress: { spell: due() } });

    const response = await submitRequest(spelling(card.id, "x' OR '1'='1"));

    expect(response.status).toBe(200);
    expect((await progressRows(card.id)).find((row) => row.mode === 'spell')?.round).toBe(1);
  });

  it('never give away the hidden word of a Spell question in any form or case', async () => {
    const member = await signInAsMember();
    await insertReviewCard(member.id, {
      lemma: 'mouse',
      pos: 'noun',
      meaningZh: '老鼠',
      acceptedForms: ['mouse', 'mice'],
      examples: ['Mice ran across the floor.', 'A mouse lives in the old barn; the MOUSE is shy.'],
      progress: { spell: due() },
    });

    const { question } = await readNext('spell');

    expect(JSON.stringify(question)).not.toMatch(/mouse|mice/i);
  });
});
