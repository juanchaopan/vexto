// The values the application reads at run time: the web application on Vercel, and the Cloud Run
// job vexto-collect and service vexto-tts on Google Cloud. Each deployment target's GitHub
// environment holds them, secrets as environment secrets and the rest as environment variables.
// Before every deployment the deployment job copies each value to where its readers run:
//   web      the Production environment of the target's Vercel project (scripts/sync-vercel-env.ts)
//   collect,
//   tts      secrets to the target's Secret Manager (scripts/sync-secret-manager.ts) and variables
//            to the Cloud Run job's and service's environment (scripts/deploy-cloud-run.ts)
// Each copy is overwritten on every deployment, so the GitHub environment stays the only place a
// value is changed. The deployment job's own settings, such as the Vercel token and the direct
// database address the migrations use, are not runtime values and are not listed here.
//
// Each sync step of .github/workflows/deploy-target.yml names every value it copies in its env,
// so the step receives these values and no other secret. This list is the source of truth for
// those envs: syncStepEnv() gives the entries a step must have, and a unit test fails when a
// workflow step differs from it. A new runtime value is added to this list, to the steps' env as
// the test prints it, and to the GitHub environments.

export type RuntimeValueKind = 'secret' | 'variable';

/** Who reads a value: the web application, the collection job or the speech service. */
export type RuntimeReader = 'web' | 'collect' | 'tts';

export type RuntimeValue = {
  name: string;
  kind: RuntimeValueKind;
  readers: readonly RuntimeReader[];
};

export const runtimeValues: readonly RuntimeValue[] = [
  { name: 'DATABASE_URL', kind: 'secret', readers: ['web', 'collect'] },
  { name: 'CLERK_SECRET_KEY', kind: 'secret', readers: ['web'] },
  { name: 'OPENAI_API_KEY', kind: 'secret', readers: ['web'] },
  { name: 'S3_ACCESS_KEY_ID', kind: 'secret', readers: ['web', 'collect', 'tts'] },
  { name: 'S3_SECRET_ACCESS_KEY', kind: 'secret', readers: ['web', 'collect', 'tts'] },
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', kind: 'variable', readers: ['web'] },
  { name: 'S3_ENDPOINT', kind: 'variable', readers: ['web', 'collect', 'tts'] },
  { name: 'S3_REGION', kind: 'variable', readers: ['web', 'collect', 'tts'] },
  { name: 'S3_BUCKET', kind: 'variable', readers: ['web', 'collect', 'tts'] },
  { name: 'TTS_SERVICE_URL', kind: 'variable', readers: ['web'] },
  { name: 'GCP_VERCEL_PROVIDER', kind: 'variable', readers: ['web'] },
  { name: 'GCP_TTS_INVOKER_SERVICE_ACCOUNT', kind: 'variable', readers: ['web'] },
];

const cloudRunReaders: readonly RuntimeReader[] = ['collect', 'tts'];

/** The values the web application reads, which go to the Vercel project. */
export const webValues = runtimeValues.filter((value) => value.readers.includes('web'));

/** The secrets a Cloud Run resource reads, which go to Secret Manager. */
export const cloudRunSecrets = runtimeValues.filter(
  (value) => value.kind === 'secret' && value.readers.some((r) => cloudRunReaders.includes(r)),
);

/** The variables a Cloud Run resource reads, which go to its environment. */
export const cloudRunVariables = runtimeValues.filter(
  (value) => value.kind === 'variable' && value.readers.some((r) => cloudRunReaders.includes(r)),
);

/** A step's environment, by name. */
export type StepEnv = Readonly<Record<string, string | undefined>>;

export type RuntimeValueWithContent = RuntimeValue & { value: string };

export type SyncPlan = {
  /** Values to copy, in list order. */
  upload: RuntimeValueWithContent[];
  /** Names with no value in the GitHub environment; their copies stay as they are. */
  skipped: string[];
  /** Settings that stop the sync: a value stored under the wrong kind, or a name not passed. */
  errors: string[];
};

/**
 * Name of the flag that tells whether the GitHub environment also holds the value under the
 * other kind: a secret's flag reads the variables, a variable's flag reads the secrets.
 */
export function otherKindFlag({ name, kind }: Pick<RuntimeValue, 'name' | 'kind'>) {
  return kind === 'secret' ? `${name}_STORED_AS_VARIABLE` : `${name}_STORED_AS_SECRET`;
}

/**
 * The env entries a sync step of deploy-target.yml must have for these values, as name and
 * expression. A value is read by name from its own kind's context only, so a variable never
 * reads a secret. The flag compares the other context's entry of the same name with the empty
 * string, so the step learns whether a value is stored under the wrong kind without receiving
 * that value.
 */
export function syncStepEnv(values: readonly RuntimeValue[]) {
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
 * Decides what a sync step copies. A value stored under the other kind stops the sync instead of
 * being copied with the wrong sensitivity or silently left out. A flag that is neither true nor
 * false means the step does not pass the name, which also stops the sync, so a name added to the
 * list but not to the workflow is never skipped unnoticed.
 */
export function planSync(env: StepEnv, values: readonly RuntimeValue[]): SyncPlan {
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
      plan.upload.push({ ...value, value: content });
    }
  }
  return plan;
}

/**
 * The environment a command that copies the values runs with: the step's environment without the
 * values and their flags, so each value reaches the command on standard input only.
 */
export function cliEnv<Env extends StepEnv>(env: Env, values: readonly RuntimeValue[]): Env {
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
