// Structured logs for the Cloud Run job and services: one JSON object per line on standard
// output, which Cloud Logging reads as a log entry with its severity and message. Callers pass
// identifiers, counts and durations only, never article text, looked-up words or secrets.

export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export type LogFields = Readonly<Record<string, unknown>>;

export function log(severity: Severity, message: string, fields: LogFields = {}) {
  const entry = { ...fields, severity, message, time: new Date().toISOString() };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

/** Fields that describe a caught error in a log entry. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { error: error.message, stack: error.stack };
  }
  return { error: String(error) };
}
