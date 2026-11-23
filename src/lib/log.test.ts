import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorFields, log } from './log.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const email = 'learner@example.com';
const lookupContext = 'She kept a stiff upper lip';

/** A PostgreSQL error as postgres.js throws it: a SQLSTATE code and a message quoting a value. */
function postgresError(code: string, message: string) {
  return Object.assign(new Error(message), { name: 'PostgresError', code, detail: message });
}

function failedQuery() {
  return new DrizzleQueryError(
    'insert into "lookups" ("member_id", "context") values ($1, $2)',
    [email, lookupContext],
    postgresError('23505', `duplicate key value: (context)=(${lookupContext})`),
  );
}

describe('errorFields', () => {
  it('describes a failed query by its name and its cause by its SQLSTATE', () => {
    const fields = errorFields(failedQuery());

    expect(fields).toMatchObject({
      error: { name: 'DrizzleQueryError' },
      causes: [{ name: 'PostgresError', code: '23505' }],
    });
  });

  it('writes no query, parameter values or messages of a failed query', () => {
    const written = JSON.stringify(errorFields(failedQuery()));

    expect(written).not.toContain(email);
    expect(written).not.toContain(lookupContext);
    expect(written).not.toContain('insert into');
    expect(written).not.toContain('duplicate key');
  });

  it('keeps the stack frames and leaves out the message at the top of the stack', () => {
    const fields = errorFields(new Error(`no member ${email}`));

    expect(fields.stack).toMatch(/^at /);
    expect(String(fields.stack)).toContain('log.test.ts');
    expect(JSON.stringify(fields)).not.toContain(email);
  });

  it('does not read a line of a message shaped like a frame as a frame', () => {
    const fields = errorFields(new Error(`Failed query\n    at ${email} (${lookupContext})`));

    expect(JSON.stringify(fields)).not.toContain(email);
    expect(JSON.stringify(fields)).not.toContain(lookupContext);
  });

  it('writes no stack that does not hold the message', () => {
    const error = new Error('Failed query');
    error.stack = `Error: params: ${email}\n    at ${email} (${lookupContext})`;

    expect(errorFields(error).stack).toBeUndefined();
    expect(JSON.stringify(errorFields(error))).not.toContain(email);
  });

  it('writes a numeric code, and leaves out a code that is not an identifier', () => {
    expect(errorFields(Object.assign(new Error('x'), { code: 503 })).error).toEqual({
      name: 'Error',
      code: '503',
    });
    expect(errorFields(Object.assign(new Error('x'), { code: `bad ${email}` })).error).toEqual({
      name: 'Error',
    });
  });

  it('names a thrown value that is not an Error by its type only', () => {
    expect(errorFields(`no member ${email}`)).toEqual({ error: { name: 'string' } });
    expect(errorFields(null)).toEqual({ error: { name: 'null' } });
  });

  it('stops following a cycle of causes', () => {
    const first = new Error('a');
    const second = new Error('b', { cause: first });
    first.cause = second;

    expect(errorFields(first).causes).toHaveLength(5);
  });
});

describe('log', () => {
  it('writes one JSON line with the fields, the severity, the message and the time', () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    log('ERROR', 'The request failed unexpectedly.', {
      requestId: 'req_1',
      ...errorFields(failedQuery()),
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0])).toMatchObject({
      requestId: 'req_1',
      severity: 'ERROR',
      message: 'The request failed unexpectedly.',
      error: { name: 'DrizzleQueryError' },
      causes: [{ name: 'PostgresError', code: '23505' }],
      time: expect.any(String),
    });
    expect(lines[0]).not.toContain(email);
    expect(lines[0]).not.toContain(lookupContext);
  });
});
