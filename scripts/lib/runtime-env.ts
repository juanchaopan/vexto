// The values the application reads at run time on Vercel. Each deployment target's GitHub
// environment holds them, secrets as environment secrets and the rest as environment variables;
// the deployment job copies them into the Production environment of the target's Vercel project
// (scripts/sync-vercel-env.ts). A new runtime value is added to this list and to the GitHub
// environments, nowhere else.

export type RuntimeValueKind = 'secret' | 'variable';

export type RuntimeValue = { name: string; kind: RuntimeValueKind };

export const runtimeValues: readonly RuntimeValue[] = [
  { name: 'DATABASE_URL', kind: 'secret' },
  { name: 'DATABASE_URL_UNPOOLED', kind: 'secret' },
  { name: 'CLERK_SECRET_KEY', kind: 'secret' },
  { name: 'OPENAI_API_KEY', kind: 'secret' },
  { name: 'S3_ACCESS_KEY_ID', kind: 'secret' },
  { name: 'S3_SECRET_ACCESS_KEY', kind: 'secret' },
  { name: 'CRON_SECRET', kind: 'secret' },
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', kind: 'variable' },
  { name: 'S3_ENDPOINT', kind: 'variable' },
  { name: 'S3_REGION', kind: 'variable' },
  { name: 'S3_BUCKET', kind: 'variable' },
];

/** Name and value pairs of one GitHub context, such as `toJSON(secrets)` or `toJSON(vars)`. */
export type ContextValues = Record<string, unknown>;

export type SyncPlan = {
  /** Values to write to Vercel, in list order. */
  upload: { name: string; kind: RuntimeValueKind; value: string }[];
  /** Names with no value in the GitHub environment; Vercel keeps whatever it has for them. */
  skipped: string[];
  /** Settings that would store a value under the wrong kind; the sync must not run. */
  errors: string[];
};

/** Parses the JSON of a GitHub context passed through an environment variable. */
export function parseContext(json: string | undefined, label: string): ContextValues {
  if (json === undefined || json.trim() === '') {
    return {};
  }
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object of names and values.`);
  }
  return parsed as ContextValues;
}

function present(context: ContextValues, name: string) {
  const value = context[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Decides what to write to Vercel. A secret is read only from the environment's secrets and a
 * variable only from its variables, so a value stored under the other kind stops the sync instead
 * of being uploaded as plain text or silently left out.
 */
export function planSync(
  secrets: ContextValues,
  variables: ContextValues,
  values: readonly RuntimeValue[] = runtimeValues,
): SyncPlan {
  const plan: SyncPlan = { upload: [], skipped: [], errors: [] };
  for (const { name, kind } of values) {
    const own = kind === 'secret' ? secrets : variables;
    const other = kind === 'secret' ? variables : secrets;
    if (present(other, name) !== undefined) {
      const where = kind === 'secret' ? 'an environment secret' : 'an environment variable';
      plan.errors.push(`${name} is a ${kind}; store it in the GitHub environment as ${where}.`);
      continue;
    }
    const value = present(own, name);
    if (value === undefined) {
      plan.skipped.push(name);
    } else {
      plan.upload.push({ name, kind, value });
    }
  }
  return plan;
}

/**
 * Arguments of `vercel env add` for one value. The value itself is never an argument: the
 * command reads it from standard input.
 */
export function envAddArgs(name: string, kind: RuntimeValueKind) {
  return [
    'env',
    'add',
    name,
    '--environment',
    'production',
    '--force',
    '--yes',
    kind === 'secret' ? '--sensitive' : '--no-sensitive',
  ];
}
