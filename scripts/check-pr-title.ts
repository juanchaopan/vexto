// Checks a pull request title against the branch it comes from (see scripts/lib/pr-title.ts).
// Usage: node scripts/check-pr-title.ts [--title <title>] [--branch <head branch>]
// Without the options the values come from the PR_TITLE and PR_HEAD_BRANCH environment
// variables, so CI can pass the untrusted title without putting it on a command line.
import { parseArgs } from 'node:util';
import { branchNamingHelp, parseBranch } from './lib/branches.ts';
import { checkPrTitle } from './lib/pr-title.ts';

const { values } = parseArgs({
  options: {
    title: { type: 'string' },
    branch: { type: 'string' },
  },
});

const title = values.title ?? process.env.PR_TITLE;
const branchName = values.branch ?? process.env.PR_HEAD_BRANCH;
if (title === undefined || !branchName) {
  console.error('Pass --title and --branch, or set PR_TITLE and PR_HEAD_BRANCH.');
  process.exit(1);
}

const branch = parseBranch(branchName);
const problems = checkPrTitle(title, branch);
if (problems.length === 0) {
  console.log(`ok  "${title}" for ${branch.name}`);
} else {
  console.error(`FAIL  "${title}" for ${branch.name}`);
  problems.forEach((problem) => console.error(`  - ${problem}`));
  if (branch.kind === 'unknown') {
    console.error(branchNamingHelp);
  }
}
process.exitCode = problems.length > 0 ? 1 : 0;
