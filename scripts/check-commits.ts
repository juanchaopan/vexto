// Checks commits against the workflow rules: the commit type matches the branch's issue type,
// the first line ends with the branch's issue number, the Step trailer is there and the commit
// changes only the files its step may change (see scripts/lib/commit-rules.ts).
//
// Usage:
//   node scripts/check-commits.ts --message-file <file>   the commit-msg hook: checks the message
//                                                         being written and the staged files
//   node scripts/check-commits.ts --range <from>..<to>    CI and `task commits-check`: checks every
//                                                         commit of the range
// Options:
//   --branch <name>    branch the commits belong to (default: the current branch)
//   --main-ref <ref>   ref of main used to recognise merges of main (default: origin/main)
//
// Skipped commits: a merge commit whose parents after the first are all reachable from the main
// ref (it brings main into the branch), and a commit without parents (the start of the project).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { branchNamingHelp, parseBranch } from './lib/branches.ts';
import {
  checkCommit,
  type CommitResult,
  type CommitToCheck,
  type SkipReason,
} from './lib/commit-rules.ts';
import {
  changedFilesOf,
  commitsIn,
  currentBranch,
  mergesMain,
  messageOf,
  parentsOf,
  pendingMergeHeads,
  readMessage,
  refExists,
  stagedFiles,
} from './lib/git.ts';

const { values } = parseArgs({
  options: {
    'message-file': { type: 'string' },
    range: { type: 'string' },
    branch: { type: 'string' },
    'main-ref': { type: 'string', default: 'origin/main' },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const mainRef = values['main-ref'];
const branchName = values.branch || currentBranch();
if (!branchName) {
  fail('Cannot tell which branch the commits belong to; pass --branch <name>.');
}
if (Boolean(values['message-file']) === Boolean(values.range)) {
  fail('Pass either --message-file <file> or --range <from>..<to>.');
}
if (!refExists(mainRef)) {
  fail(`The main ref ${mainRef} does not exist; fetch it or pass --main-ref <ref>.`);
}

const branch = parseBranch(branchName);

function skipReasonOf(parents: readonly string[]): SkipReason | undefined {
  if (parents.length === 0) {
    return 'project-start';
  }
  return mergesMain(parents, mainRef) ? 'merges-main' : undefined;
}

function commitBeingWritten(messageFile: string): CommitToCheck {
  // HEAD is the first parent; a merge in progress adds the commits in MERGE_HEAD.
  const parents = ['HEAD', ...pendingMergeHeads()];
  return {
    id: 'the commit being written',
    message: readMessage(readFileSync(messageFile, 'utf8')),
    files: stagedFiles(),
    skip: mergesMain(parents, mainRef) ? 'merges-main' : undefined,
  };
}

function commitOfRange(sha: string): CommitToCheck {
  const parents = parentsOf(sha);
  const skip = skipReasonOf(parents);
  return {
    id: sha.slice(0, 12),
    message: readMessage(messageOf(sha)),
    files: skip ? [] : changedFilesOf(sha, parents),
    skip,
  };
}

const commits = values['message-file']
  ? [commitBeingWritten(values['message-file'])]
  : commitsIn(values.range ?? '').map(commitOfRange);

const skipLabels: Record<SkipReason, string> = {
  'merges-main': 'merge of main',
  'project-start': 'start of the project',
};

function report(result: CommitResult) {
  if (result.skipped) {
    console.log(`skip  ${result.id}  ${result.header}  (${skipLabels[result.skipped]})`);
    return;
  }
  if (result.problems.length === 0) {
    console.log(`ok    ${result.id}  ${result.header}`);
    return;
  }
  console.error(`FAIL  ${result.id}  ${result.header}`);
  result.problems.forEach((problem) => console.error(`      - ${problem}`));
}

const results = commits.map((commit) => checkCommit(branch, commit));
results.forEach(report);

const failed = results.filter((result) => result.problems.length > 0).length;
if (branch.kind === 'unknown' && failed > 0) {
  console.error(branchNamingHelp);
}
if (values.range) {
  console.log(`${results.length} commits on ${branch.name}: ${failed} failed.`);
}
process.exitCode = failed > 0 ? 1 : 0;
