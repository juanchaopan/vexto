// Lints the GitHub Actions workflows and the repository's own actions with actionlint and zizmor,
// two standalone programs that are installed outside the repository and found on PATH.
// actionlint reads workflows only; it checks the inputs passed to a local action from the
// workflow side. zizmor audits both workflows and action definitions.
// Usage: node scripts/lint-workflows.ts [files...]
//   default: every workflow in .github/workflows and every .github/actions/<name>/action.yml
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { normalizePath } from './lib/path-patterns.ts';
import { repoRoot, run } from './lib/node-tools.ts';

const yamlFile = /\.ya?ml$/;
const workflowFile = /^\.github\/workflows\/[^/]+\.ya?ml$/;

function listDir(dir: string) {
  const absolute = path.join(repoRoot, dir);
  return existsSync(absolute) ? readdirSync(absolute, { withFileTypes: true }) : [];
}

function defaultFiles() {
  const workflows = listDir('.github/workflows')
    .filter((entry) => entry.isFile() && yamlFile.test(entry.name))
    .map((entry) => path.posix.join('.github', 'workflows', entry.name));
  const actions = listDir('.github/actions')
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      ['action.yml', 'action.yaml']
        .map((name) => path.posix.join('.github', 'actions', entry.name, name))
        .filter((file) => existsSync(path.join(repoRoot, file))),
    );
  return [...workflows, ...actions];
}

const requested = process.argv.slice(2).map(normalizePath);
const files = requested.length > 0 ? requested : defaultFiles();

if (files.length === 0) {
  console.log('No workflow or action files; nothing to lint.');
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

const workflows = files.filter((file) => workflowFile.test(file));
const actionlintCode = workflows.length > 0 ? await lint('actionlint', workflows) : 0;
const zizmorCode = await lint('zizmor', files);
process.exitCode = actionlintCode !== 0 || zizmorCode !== 0 ? 1 : 0;
