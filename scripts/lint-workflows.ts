// Lints the GitHub Actions workflows with actionlint and zizmor, two standalone programs that are
// installed outside the repository and found on PATH.
// Usage: node scripts/lint-workflows.ts [workflow files...]   (default: every file in .github/workflows)
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, run } from './lib/node-tools.ts';

const workflowsDir = path.join(repoRoot, '.github', 'workflows');
const requested = process.argv.slice(2);
const files =
  requested.length > 0
    ? requested
    : existsSync(workflowsDir)
      ? readdirSync(workflowsDir)
          .filter((name) => /\.ya?ml$/.test(name))
          .map((name) => path.posix.join('.github', 'workflows', name))
      : [];

if (files.length === 0) {
  console.log('No workflow files in .github/workflows; nothing to lint.');
  process.exit(0);
}

async function lint(command: string, args: readonly string[]) {
  try {
    return await run(command, args);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`${command} is not installed or not on PATH.`);
      return 1;
    }
    throw error;
  }
}

const actionlintCode = await lint('actionlint', files);
const zizmorCode = await lint('zizmor', files);
process.exitCode = actionlintCode !== 0 || zizmorCode !== 0 ? 1 : 0;
