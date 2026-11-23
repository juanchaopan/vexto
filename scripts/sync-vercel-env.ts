// Copies the runtime values the web application reads (webValues in scripts/lib/runtime-env.ts)
// from a GitHub environment into the Production environment of the target's Vercel project,
// overwriting what Vercel holds, so the GitHub environment stays the only place the values are
// kept. Secrets are stored as Sensitive, variables as plain values. A name with no value in the
// GitHub environment is skipped and keeps whatever Vercel has, so a target can be set up one
// value at a time.
//
// Usage: node scripts/sync-vercel-env.ts [--dry-run]
// Reads from its environment:
//   each listed name          the value, from the environment's secret or variable of that name
//   <name>_STORED_AS_VARIABLE true when a secret's name is also set as a variable
//   <name>_STORED_AS_SECRET   true when a variable's name is also set as a secret
//   VERCEL_CLI_VERSION        Vercel CLI version run through pnpm dlx
//   VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID  read by the Vercel CLI itself
// The sync step of .github/workflows/deploy-target.yml sets these; a value under the wrong kind
// or a name the step does not pass stops the sync before anything is written.
// --dry-run prints what would be written, by name and kind only, and calls nothing.
//
// Each value reaches `vercel env add` on standard input and never on a command line. The runtime
// values and their flags are removed from the CLI's environment, so the CLI sees no other value.
import { cliEnv, envAddArgs, planSync, webValues } from './lib/runtime-env.ts';
import { runPnpm } from './lib/node-tools.ts';

const dryRun = process.argv.slice(2).includes('--dry-run');
const cliVersion = process.env.VERCEL_CLI_VERSION ?? '';

const plan = planSync(process.env, webValues);

if (plan.errors.length > 0) {
  for (const error of plan.errors) {
    console.error(error);
  }
  process.exit(1);
}

if (!dryRun && !/^\d+\.\d+\.\d+$/.test(cliVersion)) {
  console.error('VERCEL_CLI_VERSION must be a version such as 1.2.3.');
  process.exit(1);
}

const env = cliEnv(process.env, webValues);

let failed = 0;
for (const { name, kind, value } of plan.upload) {
  const args = envAddArgs(name, kind);
  console.log(`${dryRun ? 'Would write' : 'Writing'} ${kind} ${name}: vercel ${args.join(' ')}`);
  if (dryRun) {
    continue;
  }
  const code = await runPnpm(['dlx', `vercel@${cliVersion}`, ...args], { env, input: value });
  if (code !== 0) {
    console.error(`Writing ${name} to Vercel failed.`);
    failed += 1;
  }
}

if (plan.skipped.length > 0) {
  console.log(`No value in the GitHub environment, left as they are: ${plan.skipped.join(', ')}.`);
}

process.exitCode = failed > 0 ? 1 : 0;
