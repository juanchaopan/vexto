// The values the application reads at run time on Vercel. Each deployment target's GitHub
// environment holds them, secrets as environment secrets and the rest as environment variables;
// the deployment job copies them into the Production environment of the target's Vercel project
// (scripts/sync-vercel-env.ts).
//
// The sync step of .github/workflows/deploy-target.yml names every value here in its env, so the
// step receives these values and no other secret. This list is the source of truth for that env:
// syncStepEnv() gives the entries the step must have, and a unit test fails when the workflow
// differs from it. A new runtime value is added to this list, to the step's env as the test
// prints it, and to the GitHub environments.

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

/** The sync step's environment, by name. */
export type StepEnv = Readonly<Record<string, string | undefined>>;

export type SyncPlan = {
  /** Values to write to Vercel, in list order. */
  upload: { name: string; kind: RuntimeValueKind; value: string }[];
  /** Names with no value in the GitHub environment; Vercel keeps whatever it has for them. */
  skipped: string[];
  /** Settings that stop the sync: a value stored under the wrong kind, or a name not passed. */
  errors: string[];
};

/**
 * Name of the flag that tells whether the GitHub environment also holds the value under the
 * other kind: a secret's flag reads the variables, a variable's flag reads the secrets.
 */
export function otherKindFlag({ name, kind }: RuntimeValue) {
  return kind === 'secret' ? `${name}_STORED_AS_VARIABLE` : `${name}_STORED_AS_SECRET`;
}

/**
 * The env entries the sync step of deploy-target.yml must have, as name and expression. A value
 * is read by name from its own kind's context only, so a variable never reads a secret. The flag
 * compares the other context's entry of the same name with the empty string, so the step learns
 * whether a value is stored under the wrong kind without receiving that value.
 */
export function syncStepEnv(values: readonly RuntimeValue[] = runtimeValues) {
  const env: Record<string, string> = {};
  for (const value of values) {
    const own = value.kind === 'secret' ? 'secrets' : 'vars';
    const other = value.kind === 'secret' ? 'vars' : 'secrets';
    env[value.name] = `\${{ ${own}.${value.name} }}`;
    env[otherKindFlag(value)] = `\${{ ${other}.${value.name} != '' }}`;
  }
  return env;
}

/**
 * Decides what to write to Vercel. A value stored under the other kind stops the sync instead of
 * being uploaded with the wrong sensitivity or silently left out. A flag that is neither true nor
 * false means the step does not pass the name, which also stops the sync, so a name added to the
 * list but not to the workflow is never skipped unnoticed.
 */
export function planSync(env: StepEnv, values: readonly RuntimeValue[] = runtimeValues): SyncPlan {
  const plan: SyncPlan = { upload: [], skipped: [], errors: [] };
  for (const value of values) {
    const { name, kind } = value;
    const flag = env[otherKindFlag(value)];
    if (flag === 'true') {
      const where = kind === 'secret' ? 'an environment secret' : 'an environment variable';
      plan.errors.push(`${name} is a ${kind}; store it in the GitHub environment as ${where}.`);
      continue;
    }
    if (flag !== 'false') {
      plan.errors.push(
        `${name} is not passed to the sync step; add it to the step's env in .github/workflows/deploy-target.yml.`,
      );
      continue;
    }
    const content = env[name];
    if (content === undefined || content === '') {
      plan.skipped.push(name);
    } else {
      plan.upload.push({ name, kind, value: content });
    }
  }
  return plan;
}

/**
 * The environment the Vercel CLI runs with: the step's environment without the runtime values and
 * their flags, so each value reaches the CLI on standard input only.
 */
export function cliEnv<Env extends StepEnv>(
  env: Env,
  values: readonly RuntimeValue[] = runtimeValues,
): Env {
  const result: Record<string, string | undefined> = { ...env };
  for (const name of Object.keys(syncStepEnv(values))) {
    delete result[name];
  }
  return result as Env;
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
