// Links the repository to a Vercel project and pulls that project's Development values into
// .env.local, both with the Vercel CLI run through pnpm dlx.
// Usage: node scripts/env-pull.ts
// Reads from its environment:
//   VERCEL_CLI_VERSION  Vercel CLI version, pinned in Taskfile.yml
//   VERCEL_PROJECT      project to link instead of the one in scripts/env-pull.json
//   VERCEL_SCOPE        team of the project instead of the one in scripts/env-pull.json
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { envPullCommands, parseEnvPullConfig, resolveEnvPullTarget } from './lib/env-pull.ts';
import { repoRoot, runPnpm } from './lib/node-tools.ts';

const configFile = path.join(repoRoot, 'scripts', 'env-pull.json');

let commands: string[][];
try {
  const config = parseEnvPullConfig(readFileSync(configFile, 'utf8'));
  const target = resolveEnvPullTarget(config, process.env);
  console.log(`Pulling the Development values of ${target.project} (team ${target.scope}).`);
  commands = envPullCommands(process.env.VERCEL_CLI_VERSION, target);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

for (const args of commands) {
  const code = await runPnpm(args);
  if (code !== 0) {
    console.error(`pnpm ${args.join(' ')} failed with exit code ${code}.`);
    process.exit(code);
  }
}
