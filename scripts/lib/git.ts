// Reads commits, messages and changed files from git for the commit and step checks.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { CommitMessage, Trailer } from './commit-rules.ts';
import { repoRoot } from './node-tools.ts';

type GitOptions = { cwd?: string; input?: string };

/** Runs git and returns its standard output; a failing git command throws with its stderr. */
export function git(args: readonly string[], options: GitOptions = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd ?? repoRoot,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function splitNul(output: string) {
  return output.split('\0').filter((entry) => entry !== '');
}

const scissorsLine = /^# -+ >8 -+$/m;

/**
 * Removes what git strips before it stores a message written in an editor: everything below the
 * scissors line of `git commit --verbose` and the `#` comment lines.
 */
export function cleanMessage(raw: string) {
  const scissors = scissorsLine.exec(raw);
  const kept = scissors ? raw.slice(0, scissors.index) : raw;
  return kept
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/** The trailers of the message's last paragraph, as `git interpret-trailers --parse` reads them. */
export function parseTrailers(message: string, cwd?: string): Trailer[] {
  return git(['interpret-trailers', '--parse'], { cwd, input: `${message}\n` })
    .split(/\r?\n/)
    .filter((line) => line.includes(':'))
    .map((line) => {
      const separator = line.indexOf(':');
      return { key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
    });
}

export function readMessage(raw: string, cwd?: string): CommitMessage {
  const message = cleanMessage(raw);
  const header = message.split('\n')[0] ?? '';
  return { header, trailers: parseTrailers(message, cwd) };
}

/** Commits of a range such as `origin/main..HEAD`, parents before their children. */
export function commitsIn(range: string, cwd?: string) {
  return git(['rev-list', '--reverse', '--topo-order', range], { cwd })
    .split(/\r?\n/)
    .filter((sha) => sha !== '');
}

export function parentsOf(commit: string, cwd?: string) {
  const [, ...parents] = git(['rev-list', '--parents', '-n', '1', commit], { cwd })
    .trim()
    .split(' ');
  return parents;
}

export function messageOf(commit: string, cwd?: string) {
  return git(['log', '-1', '--format=%B', commit], { cwd });
}

/**
 * Files a commit changes compared with its first parent. Renames count as a deletion and an
 * addition, so both the old and the new path are listed.
 */
export function changedFilesOf(commit: string, parents: readonly string[], cwd?: string) {
  const args =
    parents.length === 0
      ? ['diff-tree', '-r', '--root', '--no-commit-id', '--name-only', '--no-renames', '-z', commit]
      : ['diff', '--name-only', '--no-renames', '-z', parents[0], commit];
  return splitNul(git(args, { cwd }));
}

/** Files in the index that differ from HEAD, the changes the commit being written records. */
export function stagedFiles(cwd?: string) {
  return splitNul(git(['diff', '--cached', '--name-only', '--no-renames', '-z'], { cwd }));
}

export function isAncestor(ancestor: string, descendant: string, cwd?: string) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: cwd ?? repoRoot,
    stdio: 'ignore',
  });
  if (result.status === 0 || result.status === 1) {
    return result.status === 0;
  }
  throw new Error(`git merge-base --is-ancestor ${ancestor} ${descendant} failed`);
}

/**
 * True for a merge that brings main into the branch: the commit has two or more parents and
 * every parent after the first is reachable from the main ref (it is a commit of main).
 */
export function mergesMain(parents: readonly string[], mainRef: string, cwd?: string) {
  return (
    parents.length >= 2 && parents.slice(1).every((parent) => isAncestor(parent, mainRef, cwd))
  );
}

export function refExists(ref: string, cwd?: string) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd: cwd ?? repoRoot,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function gitPath(name: string, cwd?: string) {
  return git(['rev-parse', '--path-format=absolute', '--git-path', name], { cwd }).trim();
}

/**
 * The branch being committed to. During a rebase HEAD is detached, so the branch comes from the
 * rebase state; null when no branch can be found.
 */
export function currentBranch(cwd?: string) {
  const symbolic = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], {
    cwd: cwd ?? repoRoot,
    encoding: 'utf8',
  });
  if (symbolic.status === 0 && symbolic.stdout.trim() !== '') {
    return symbolic.stdout.trim();
  }
  for (const state of ['rebase-merge/head-name', 'rebase-apply/head-name']) {
    const file = gitPath(state, cwd);
    if (existsSync(file)) {
      return readFileSync(file, 'utf8')
        .trim()
        .replace(/^refs\/heads\//, '');
    }
  }
  return null;
}

/** The commits a merge in progress brings in, read from MERGE_HEAD. */
export function pendingMergeHeads(cwd?: string) {
  const file = gitPath('MERGE_HEAD', cwd);
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((sha) => sha !== '')
    : [];
}
