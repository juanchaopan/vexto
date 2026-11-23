import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES, errorBody, type ErrorCode } from './errors.ts';

// The error table of .docs/design/interfaces.md: code, status, and whether resending can help.
const interfaceTable: [ErrorCode, number, boolean][] = [
  ['UNAUTHENTICATED', 401, false],
  ['NOT_A_MEMBER', 403, false],
  ['TERMS_REQUIRED', 403, false],
  ['NOT_FOUND', 404, false],
  ['CONFLICT', 409, false],
  ['OPERATION_MISMATCH', 409, false],
  ['DUPLICATE_WORD', 409, false],
  ['SELECTION_CHANGED', 409, false],
  ['INVALID_INPUT', 422, false],
  ['HIDDEN_RANGE', 422, false],
  ['INTERNAL', 500, true],
  ['UNAVAILABLE', 503, true],
];

describe('ERROR_CODES', () => {
  it('has exactly the codes of the interface', () => {
    expect(Object.keys(ERROR_CODES)).toEqual(interfaceTable.map(([code]) => code));
  });

  it.each(interfaceTable)('answers %s with %i, retryable %s', (code, status, retryable) => {
    const error = new ApiError(code as 'NOT_FOUND', 'message');

    expect([error.status, error.retryable]).toEqual([status, retryable]);
  });
});

describe('ApiError', () => {
  it('is an Error without details unless its code has them', () => {
    const error = new ApiError('UNAVAILABLE', 'The AI did not answer in time.');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('The AI did not answer in time.');
    expect(error.details).toBeUndefined();
  });
});

describe('errorBody', () => {
  it('has code, message, retryable and requestId, and no details for most codes', () => {
    expect(errorBody(new ApiError('NOT_FOUND', 'No such card.'), 'req_1')).toEqual({
      error: { code: 'NOT_FOUND', message: 'No such card.', retryable: false, requestId: 'req_1' },
    });
  });

  it('carries the details of the codes that have them', () => {
    const error = new ApiError('SELECTION_CHANGED', 'Some words are gone.', {
      missingIds: ['c1'],
    });

    expect(errorBody(error, 'req_2')).toEqual({
      error: {
        code: 'SELECTION_CHANGED',
        message: 'Some words are gone.',
        retryable: false,
        requestId: 'req_2',
        details: { missingIds: ['c1'] },
      },
    });
  });
});
