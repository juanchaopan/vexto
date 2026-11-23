// The Neon project, branch and database of each deployment target, as written in
// scripts/neon-targets.json, and the Neon CLI command that prints a target's connection string.
// The connection string is a secret: it is read from the CLI's standard output and is never
// part of a message, a command line or a file.
import { z } from 'zod';

// pnpm commands reach the shell as one command line (see node-tools.ts), so every value that
// goes on it is limited to characters a shell reads as part of one plain word, and none may
// start with '-', which the CLI would read as an option.
const neonId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a Neon ID of lower-case letters, digits and "-"');
const databaseName = z
  .string()
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/, 'must be a database name of letters, digits, "_", "-"');
const targetName = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'must be a target name of lower-case letters, digits and "-"');

const neonTargetSchema = z.strictObject({
  projectId: neonId,
  branchId: neonId,
  /** Left out when the branch has a single database, which the CLI then picks. */
  database: databaseName.optional(),
});

const neonTargetsSchema = z
  .record(targetName, neonTargetSchema)
  .refine((targets) => Object.keys(targets).length > 0, 'must name at least one target');

export type NeonTarget = z.infer<typeof neonTargetSchema>;
export type NeonTargets = Readonly<Record<string, NeonTarget>>;

const cliVersion = /^\d+\.\d+\.\d+$/;

function describeIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
    .join('; ');
}

/** Reads the JSON of scripts/neon-targets.json: `{ "<target>": { projectId, branchId, database? } }`. */
export function parseNeonTargets(json: string): NeonTargets {
  const result = neonTargetsSchema.safeParse(JSON.parse(json));
  if (!result.success) {
    throw new Error(`The Neon targets configuration is invalid: ${describeIssues(result.error)}.`);
  }
  return result.data;
}

/** The target of that name; an unknown name fails with the names the configuration has. */
export function neonTarget(targets: NeonTargets, name: string): NeonTarget {
  const target = Object.hasOwn(targets, name) ? targets[name] : undefined;
  if (!target) {
    const known = Object.keys(targets).join(', ');
    throw new Error(`Unknown target ${JSON.stringify(name)}; the configured targets are ${known}.`);
  }
  return target;
}

/**
 * The pnpm arguments that print the target's direct connection string through the Neon CLI.
 * pnpm runs silently, so the CLI's line is the whole standard output; the CLI writes its own
 * messages to standard error. Analytics are off, so the command is not reported to Neon.
 */
export function connectionStringArgs(version: string | undefined, target: NeonTarget) {
  if (!version || !cliVersion.test(version)) {
    throw new Error('NEON_CLI_VERSION must be a version such as 1.2.3.');
  }
  const database = target.database ? ['--database-name', target.database] : [];
  return [
    '--silent',
    'dlx',
    `neonctl@${version}`,
    'connection-string',
    target.branchId,
    '--project-id',
    target.projectId,
    ...database,
    '--no-analytics',
  ];
}

/**
 * The connection string in the CLI's standard output. Anything other than one PostgreSQL URL
 * fails with a message that does not repeat the output, since it may hold the password.
 */
export function readConnectionString(stdout: string) {
  const text = stdout.trim();
  let protocol = '';
  try {
    protocol = new URL(text).protocol;
  } catch {
    protocol = '';
  }
  if (/\s/.test(text) || !['postgres:', 'postgresql:'].includes(protocol)) {
    throw new Error('The Neon CLI did not print a PostgreSQL connection string.');
  }
  return text;
}
