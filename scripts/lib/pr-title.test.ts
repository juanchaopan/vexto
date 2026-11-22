import { describe, expect, it } from 'vitest';
import { parseBranch } from './branches.ts';
import { checkPrTitle } from './pr-title.ts';

const check = (title: string, branchName: string) => checkPrTitle(title, parseBranch(branchName));

describe('checkPrTitle on issue branches', () => {
  it('accepts the issue type and the issue number', () => {
    expect(check('chore: set up the project (#1)', 'maintenance/1-set-up-the-project')).toEqual([]);
    expect(check('feat(reader): add word lookup (#12)', 'feature/12-word-lookup')).toEqual([]);
    expect(check('fix: keep empty feeds (#3)', 'fix/3-empty-feed')).toEqual([]);
    expect(check('refactor!: split the reader (#40)', 'refactor/40-split-reader')).toEqual([]);
  });

  it('rejects a type that does not match the issue type', () => {
    expect(check('feat: set up the project (#1)', 'maintenance/1-set-up-the-project')[0]).toMatch(
      /use "chore"/,
    );
    expect(check('fix: add word lookup (#12)', 'feature/12-word-lookup')[0]).toMatch(/use "feat"/);
  });

  it('rejects a missing or mismatched issue number', () => {
    expect(check('feat: add word lookup', 'feature/12-word-lookup')).toEqual([
      'The first line must end with the issue reference (#12).',
    ]);
    expect(check('feat: add word lookup (#21)', 'feature/12-word-lookup')[0]).toMatch(
      /#21 does not match issue #12/,
    );
  });

  it('rejects titles longer than 100 characters', () => {
    const title = `feat: ${'a'.repeat(90)} (#12)`;
    expect(check(title, 'feature/12-word-lookup')[0]).toMatch(/at most 100/);
  });
});

describe('checkPrTitle on release branches', () => {
  it('accepts exactly chore(release): <version>', () => {
    expect(check('chore(release): 1.4.0', 'release/1.4.0')).toEqual([]);
  });

  it.each(['chore(release): 1.4.1', 'chore(release): 1.4.0 (#5)', 'chore: release 1.4.0'])(
    'rejects %s',
    (title) => {
      expect(check(title, 'release/1.4.0')).toEqual([
        'A release pull request is titled "chore(release): 1.4.0".',
      ]);
    },
  );
});

describe('checkPrTitle on Renovate branches', () => {
  it.each(['fix(deps): update next to 16.5.0', 'chore(deps): update dependency vitest to v6'])(
    'accepts %s',
    (title) => {
      expect(check(title, 'renovate/some-update')).toEqual([]);
    },
  );

  it.each([
    'chore: update next',
    'feat(deps): update next',
    'chore(deps): update next (#4)',
    'chore(deps)!: update next',
    'Update next',
  ])('rejects %s', (title) => {
    expect(check(title, 'renovate/some-update')).toHaveLength(1);
  });
});

describe('checkPrTitle on branches without pull requests', () => {
  const branches = ['scratch/12-reader-layout', 'main', 'spike/8-tts', 'my-branch'];

  it.each(branches)('rejects %s', (name) => {
    const [problem] = check('chore: anything (#12)', name);
    expect(problem).toMatch(/is not merged through a pull request/);
  });
});
