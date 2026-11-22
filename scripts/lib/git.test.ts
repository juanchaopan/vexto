import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changedFilesOf,
  cleanMessage,
  commitsIn,
  currentBranch,
  git,
  mergesMain,
  parentsOf,
  parseTrailers,
  readMessage,
  stagedFiles,
} from './git.ts';

// A throwaway repository with this history:
//   main:     start ─ docs ─────────── fix
//                         \                \
//   feature:               work ─ side-merge ─ main-merge
//                            \     /
//   side:                     extra
let repo: string;
const sha: Record<string, string> = {};

const run = (...args: string[]) => git(args, { cwd: repo }).trim();

async function commitFile(file: string, content: string, subject: string) {
  await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
  run('add', '--all');
  run('commit', '--quiet', '--message', subject);
  return run('rev-parse', 'HEAD');
}

beforeAll(async () => {
  repo = mkdtempSync(path.join(tmpdir(), 'git-history-'));
  run('init', '--quiet', '--initial-branch', 'main');
  run('config', 'user.name', 'Test');
  run('config', 'user.email', 'test@example.com');
  run('config', 'commit.gpgsign', 'false');
  run('config', 'core.autocrlf', 'false');
  sha.start = await commitFile('.docs/brief.md', 'brief\n', 'chore: start the project');
  sha.docs = await commitFile('.docs/architecture.md', 'arch\n', 'docs on main');
  run('switch', '--quiet', '--create', 'feature/2-work', sha.start);
  sha.work = await commitFile('src/a.ts', 'a\n', 'feat: work (#2)');
  run('switch', '--quiet', '--create', 'side', sha.work);
  sha.extra = await commitFile('src/b.ts', 'b\n', 'feat: extra (#2)');
  run('switch', '--quiet', 'feature/2-work');
  run('merge', '--quiet', '--no-ff', '--no-edit', 'side');
  sha.sideMerge = run('rev-parse', 'HEAD');
  run('switch', '--quiet', 'main');
  sha.fix = await commitFile('.docs/design/x.md', 'x\n', 'design on main');
  run('switch', '--quiet', 'feature/2-work');
  run('merge', '--quiet', '--no-ff', '--no-edit', 'main');
  sha.mainMerge = run('rev-parse', 'HEAD');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('mergesMain', () => {
  it('is true for a merge whose merged-in parent is a commit of main', () => {
    expect(mergesMain(parentsOf(sha.mainMerge, repo), 'main', repo)).toBe(true);
  });

  it('is false for a merge of another branch', () => {
    expect(mergesMain(parentsOf(sha.sideMerge, repo), 'main', repo)).toBe(false);
  });

  it('is false for ordinary commits, even commits of main', () => {
    expect(mergesMain(parentsOf(sha.work, repo), 'main', repo)).toBe(false);
    expect(mergesMain(parentsOf(sha.fix, repo), 'main', repo)).toBe(false);
  });
});

describe('commits and changed files', () => {
  it('lists the commits of a range oldest first', () => {
    expect(commitsIn('main..feature/2-work', repo)).toEqual([
      sha.work,
      sha.extra,
      sha.sideMerge,
      sha.mainMerge,
    ]);
  });

  it('reads parents, with none for the first commit', () => {
    expect(parentsOf(sha.start, repo)).toEqual([]);
    expect(parentsOf(sha.mainMerge, repo)).toEqual([sha.sideMerge, sha.fix]);
  });

  it('lists the files a commit changes against its first parent', () => {
    expect(changedFilesOf(sha.start, [], repo)).toEqual(['.docs/brief.md']);
    expect(changedFilesOf(sha.work, parentsOf(sha.work, repo), repo)).toEqual(['src/a.ts']);
    expect(changedFilesOf(sha.mainMerge, parentsOf(sha.mainMerge, repo), repo).sort()).toEqual([
      '.docs/architecture.md',
      '.docs/design/x.md',
    ]);
  });

  it('lists both paths of a rename and the staged files', async () => {
    run('mv', 'src/a.ts', 'src/renamed.ts');
    expect(stagedFiles(repo).sort()).toEqual(['src/a.ts', 'src/renamed.ts']);
    run('commit', '--quiet', '--message', 'refactor: rename');
    const renamed = run('rev-parse', 'HEAD');
    expect(changedFilesOf(renamed, parentsOf(renamed, repo), repo).sort()).toEqual([
      'src/a.ts',
      'src/renamed.ts',
    ]);
    expect(currentBranch(repo)).toBe('feature/2-work');
  });
});

describe('messages and trailers', () => {
  const written = [
    'chore(scaffold): add hooks (#1)',
    '',
    'Body text with a colon: not a trailer.',
    '',
    'Step: scaffold',
    'Co-Authored-By: An Agent <agent@example.com>',
    'Claude-Session: https://claude.ai/code/session_example',
    '# Please enter the commit message for your changes.',
    '# ------------------------ >8 ------------------------',
    'diff --git a/x b/x',
  ].join('\n');

  it('drops comment lines and everything below the scissors line', () => {
    expect(cleanMessage(written)).toBe(
      [
        'chore(scaffold): add hooks (#1)',
        '',
        'Body text with a colon: not a trailer.',
        '',
        'Step: scaffold',
        'Co-Authored-By: An Agent <agent@example.com>',
        'Claude-Session: https://claude.ai/code/session_example',
      ].join('\n'),
    );
  });

  it('reads the header and the trailers of the last paragraph', () => {
    expect(readMessage(written, repo)).toEqual({
      header: 'chore(scaffold): add hooks (#1)',
      trailers: [
        { key: 'Step', value: 'scaffold' },
        { key: 'Co-Authored-By', value: 'An Agent <agent@example.com>' },
        { key: 'Claude-Session', value: 'https://claude.ai/code/session_example' },
      ],
    });
  });

  it('ignores Step lines that are not in the final trailer block', () => {
    expect(parseTrailers('feat: x (#2)\n\nStep: implement\n\nMore body text.', repo)).toEqual([]);
    expect(parseTrailers('feat: x (#2)\nStep: implement', repo)).toEqual([]);
  });
});
