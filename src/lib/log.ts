// Structured logs for the web application, the Cloud Run job and services: one JSON object per
// line on standard output, which Cloud Logging reads as a log entry with its severity and
// message. Callers pass identifiers, counts and durations only, never article text, looked-up
// words, email addresses or secrets.

export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export type LogFields = Readonly<Record<string, unknown>>;

export function log(severity: Severity, message: string, fields: LogFields = {}) {
  const entry = { ...fields, severity, message, time: new Date().toISOString() };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

/** How many errors of a cause chain are described, so a cycle of causes cannot run forever. */
const MAX_CAUSES = 5;

/** A code worth logging: a short identifier such as a PostgreSQL SQLSTATE or ECONNRESET. */
const CODE_PATTERN = /^[\w.-]{1,64}$/;

/** A stack line that names a function and a source position. */
const FRAME_PATTERN = /^\s+at /;

export type ErrorSummary = { name: string; code?: string };

/**
 * Fields that describe a caught error in a log entry: `error` with the error's name and code,
 * `causes` with the names and codes of its causes, and `stack` with the stack frames. Messages
 * are never written: a failed query's message holds its SQL and bound parameters, and a database
 * or service error can quote the values it refused, so any message may carry what a user looked
 * up, searched for or their email address.
 */
export function errorFields(error: unknown): LogFields {
  const fields: Record<string, unknown> = { error: summarize(error) };
  const causes = causeChain(error).map(summarize);
  if (causes.length > 0) {
    fields.causes = causes;
  }
  const frames = stackFrames(error);
  if (frames !== undefined) {
    fields.stack = frames;
  }
  return fields;
}

function summarize(error: unknown): ErrorSummary {
  const code = errorCode(error);
  return code === undefined ? { name: errorName(error) } : { name: errorName(error), code };
}

/**
 * The error's own name, or its class's name when it keeps the generic "Error", as drizzle's
 * DrizzleQueryError does; anything thrown that is not an Error is named by its type alone.
 */
function errorName(error: unknown): string {
  if (!(error instanceof Error)) {
    return error === null ? 'null' : typeof error;
  }
  if (error.name !== 'Error') {
    return error.name;
  }
  const className = (error.constructor as { name?: unknown } | undefined)?.name;
  return typeof className === 'string' && className !== '' ? className : 'Error';
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error as { code: unknown };
  const text = typeof code === 'number' ? String(code) : code;
  return typeof text === 'string' && CODE_PATTERN.test(text) ? text : undefined;
}

function causeChain(error: unknown): unknown[] {
  const causes: unknown[] = [];
  let current = error;
  while (causes.length < MAX_CAUSES && current instanceof Error && current.cause !== undefined) {
    current = current.cause;
    causes.push(current);
  }
  return causes;
}

/**
 * The frames of the error's stack. A stack starts with the error's message, which can run over
 * several lines and hold text shaped like a frame, so only what follows the message is read; a
 * stack that does not contain the message is not written at all.
 */
function stackFrames(error: unknown): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== 'string') {
    return undefined;
  }
  const messageAt = error.stack.indexOf(error.message);
  if (messageAt < 0) {
    return undefined;
  }
  const frames = error.stack
    .slice(messageAt + error.message.length)
    .split('\n')
    .filter((line) => FRAME_PATTERN.test(line))
    .map((line) => line.trim());
  return frames.length > 0 ? frames.join('\n') : undefined;
}
