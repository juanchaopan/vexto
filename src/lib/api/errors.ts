// The one error body of the web application's HTTP interface (.docs/design/interfaces.md, 错误):
// { error: { code, message, retryable, requestId, details? } }. Each code has a fixed status and
// tells whether resending the same request can succeed; the client tells errors apart by code
// only, and `message` is English for developers, never a stack, a secret or raw model output.

export const ERROR_CODES = {
  UNAUTHENTICATED: { status: 401, retryable: false },
  NOT_A_MEMBER: { status: 403, retryable: false },
  TERMS_REQUIRED: { status: 403, retryable: false },
  NOT_FOUND: { status: 404, retryable: false },
  CONFLICT: { status: 409, retryable: false },
  OPERATION_MISMATCH: { status: 409, retryable: false },
  DUPLICATE_WORD: { status: 409, retryable: false },
  SELECTION_CHANGED: { status: 409, retryable: false },
  INVALID_INPUT: { status: 422, retryable: false },
  HIDDEN_RANGE: { status: 422, retryable: false },
  INTERNAL: { status: 500, retryable: true },
  UNAVAILABLE: { status: 503, retryable: true },
} as const satisfies Record<string, { status: number; retryable: boolean }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Codes whose body carries `details`, and what the details hold. */
export type ErrorDetails = {
  DUPLICATE_WORD: { savedCard: unknown };
  SELECTION_CHANGED: { missingIds: string[] };
};

type DetailsOf<C extends ErrorCode> = C extends keyof ErrorDetails ? ErrorDetails[C] : undefined;

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
    details?: unknown;
  };
};

/**
 * A failure a request handler throws to answer with one of the codes. Anything else thrown is
 * answered as INTERNAL without its message.
 */
export class ApiError<C extends ErrorCode = ErrorCode> extends Error {
  readonly code: C;
  readonly details: DetailsOf<C> | undefined;

  constructor(
    code: C,
    message: string,
    ...details: C extends keyof ErrorDetails ? [ErrorDetails[C]] : []
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details[0] as DetailsOf<C> | undefined;
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }

  get retryable(): boolean {
    return ERROR_CODES[this.code].retryable;
  }
}

/** The body for an error, with `details` only when the error has them. */
export function errorBody(error: ApiError, requestId: string): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
