// The Vercel project whose Development environment `task env-pull` copies into .env.local.
// scripts/env-pull.json names the project and its team (the Vercel scope); VERCEL_PROJECT and
// VERCEL_SCOPE in the environment override them, and an empty value counts as unset.

export type EnvPullTarget = { project: string; scope: string };

/** Environment variables by name, such as `process.env`. */
export type Environment = Readonly<Record<string, string | undefined>>;

// pnpm commands reach the shell as one command line (see node-tools.ts), so a name may use only
// the characters of Vercel project names, team slugs and team IDs.
const vercelName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const cliVersion = /^\d+\.\d+\.\d+$/;

function checkedName(value: unknown, label: string) {
  if (typeof value !== 'string' || !vercelName.test(value)) {
    throw new Error(
      `${label} must be a Vercel name of letters, digits, '.', '_' and '-', got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/** Reads the JSON of scripts/env-pull.json: `{ "project": <name>, "scope": <team> }`. */
export function parseEnvPullConfig(json: string): EnvPullTarget {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The env-pull configuration must be a JSON object with project and scope.');
  }
  const { project, scope } = parsed as Record<string, unknown>;
  return {
    project: checkedName(project, 'project'),
    scope: checkedName(scope, 'scope'),
  };
}

/** Applies VERCEL_PROJECT and VERCEL_SCOPE from the environment over the configuration. */
export function resolveEnvPullTarget(config: EnvPullTarget, env: Environment): EnvPullTarget {
  const project = env.VERCEL_PROJECT || config.project;
  const scope = env.VERCEL_SCOPE || config.scope;
  return {
    project: checkedName(project, 'VERCEL_PROJECT'),
    scope: checkedName(scope, 'VERCEL_SCOPE'),
  };
}

/** The pnpm arguments that link the project and pull its Development values, in order. */
export function envPullCommands(version: string | undefined, target: EnvPullTarget) {
  if (!version || !cliVersion.test(version)) {
    throw new Error('VERCEL_CLI_VERSION must be a version such as 1.2.3.');
  }
  const vercel = ['dlx', `vercel@${version}`];
  return [
    [...vercel, 'link', '--yes', '--project', target.project, '--scope', target.scope],
    [...vercel, 'env', 'pull', '.env.local', '--environment', 'development', '--yes'],
  ];
}
