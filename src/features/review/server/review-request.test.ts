// The review requests (.docs/design/interfaces.md, 复习): only Spell and Translate have questions,
// a Spell answer is 1–80 characters of text, a Translate answer an option ID, and nothing else is
// taken, such as a round.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../lib/api/errors.ts';
import { parseInput } from '../../../lib/api/route.ts';
import { nextQuestionRequest, submitRequest } from './review-request.ts';

function invalid(work: () => unknown) {
  expect(work).toThrowError(
    expect.objectContaining({ code: 'INVALID_INPUT' }) as unknown as ApiError,
  );
}

const spell = (answer: unknown, extra = {}) => ({
  operationId: randomUUID(),
  cardId: randomUUID(),
  mode: 'spell',
  answer,
  ...extra,
});

describe('the next question request', () => {
  it('takes Spell and Translate', () => {
    expect(nextQuestionRequest(new URLSearchParams('mode=spell'))).toBe('spell');
    expect(nextQuestionRequest(new URLSearchParams('mode=translate'))).toBe('translate');
  });

  it('refuses Speak, no mode, a mode given twice and other parameters', () => {
    invalid(() => nextQuestionRequest(new URLSearchParams('mode=speak')));
    invalid(() => nextQuestionRequest(new URLSearchParams('')));
    invalid(() => nextQuestionRequest(new URLSearchParams('mode=spell&mode=translate')));
    invalid(() => nextQuestionRequest(new URLSearchParams('mode=spell&round=3')));
  });
});

describe('the submit request', () => {
  it('takes a Spell answer of up to 80 characters', () => {
    expect(parseInput(submitRequest, spell({ text: 'resilient' })).mode).toBe('spell');
    expect(parseInput(submitRequest, spell({ text: 'x'.repeat(80) })).mode).toBe('spell');
  });

  it('refuses an empty, blank or longer Spell answer', () => {
    invalid(() => parseInput(submitRequest, spell({ text: '' })));
    invalid(() => parseInput(submitRequest, spell({ text: '   ' })));
    invalid(() => parseInput(submitRequest, spell({ text: 'x'.repeat(81) })));
    invalid(() => parseInput(submitRequest, spell({ text: 'a\u0000b' })));
  });

  it('takes a Translate answer by option ID only', () => {
    const body = {
      operationId: randomUUID(),
      cardId: randomUUID(),
      mode: 'translate',
      answer: { optionId: randomUUID() },
    };
    expect(parseInput(submitRequest, body).mode).toBe('translate');
    invalid(() => parseInput(submitRequest, { ...body, answer: { optionId: 'first' } }));
    invalid(() => parseInput(submitRequest, { ...body, answer: { text: 'resilient' } }));
  });

  it('refuses a round, another field, Speak and IDs that are not UUIDs', () => {
    invalid(() => parseInput(submitRequest, spell({ text: 'resilient' }, { round: 6 })));
    invalid(() => parseInput(submitRequest, spell({ text: 'resilient', correct: true })));
    invalid(() => parseInput(submitRequest, spell({ text: 'resilient' }, { mode: 'speak' })));
    invalid(() => parseInput(submitRequest, spell({ text: 'resilient' }, { cardId: '1' })));
  });
});
