import type { z } from 'zod';

/** A configuration file that does not pass its validation; the message names every problem. */
export class ConfigError extends Error {
  constructor(file: string, error: z.ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('; ');
    super(`${file} is invalid: ${issues}.`);
    this.name = 'ConfigError';
  }
}

/** Parses a configuration with its schema, or throws a ConfigError naming the file. */
export function parseConfig<T>(file: string, schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(file, result.error);
  }
  return result.data;
}
