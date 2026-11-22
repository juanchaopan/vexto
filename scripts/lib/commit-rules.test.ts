import { describe, expect, it } from 'vitest';
import { parseBranch } from './branches.ts';
import {
  checkCommit,
  checkMessage,
  checkStepFiles,
  parseHeader,
  stepOf,
  trailingIssueOf,
  type CommitToCheck,
  type Trailer,
} from './commit-rules.ts';

const maintenance = parseBranch('maintenance/1-set-up-the-project');
const feature = parseBranch('feature/12-word-lookup');

const agentTrailers: Trailer[] = [
  { key: 'Co-Authored-By', value: 'An Agent <agent@example.com>' },
  { key: 'Claude-Session', value: 'https://claude.ai/code/session_example' },
];

function message(header: string, step?: string, extra: Trailer[] = agentTrailers) {
  const stepTrailer = step === undefined ? [] : [{ key: 'Step', value: step }];
  return { header, trailers: [...stepTrailer, ...extra] };
}

function commit(overrides: Partial<CommitToCheck> & Pick<CommitToCheck, 'message'>) {
  return { id: 'abc123', files: [], ...overrides };
}

describe('parseHeader', () => {
  it('splits type, scope, breaking mark and subject', () => {
    expect(parseHeader('feat(reader)!: drop the old layout (#12)')).toEqual({
      type: 'feat',
      scope: 'reader',
      breaking: true,
      subject: 'drop the old layout (#12)',
    });
    expect(parseHeader('chore: start the project')).toEqual({
      type: 'chore',
      scope: undefined,
      breaking: false,
      subject: 'start the project',
    });
  });

  it('rejects headers without the Conventional Commits shape', () => {
    expect(parseHeader('Add the reader')).toBeNull();
    expect(parseHeader('feat:no space')).toBeNull();
    expect(parseHeader('Feat: capital type')).toBeNull();
    expect(parseHeader('feat(): empty scope')).toBeNull();
  });
});

describe('trailingIssueOf', () => {
  it('reads the issue reference at the end of the first line', () => {
    expect(trailingIssueOf('feat: add lookup (#12)')).toBe(12);
    expect(trailingIssueOf('feat: add lookup (#12) later')).toBeNull();
    expect(trailingIssueOf('feat: add lookup #12')).toBeNull();
  });
});

describe('stepOf', () => {
  it('reads the Step trailer among other trailers', () => {
    expect(stepOf(message('x', 'design').trailers)).toEqual({ step: 'design', problems: [] });
  });

  it('accepts the key in any letter case, as git does', () => {
    expect(stepOf([{ key: 'step', value: 'kickoff' }]).step).toBe('kickoff');
  });

  it('has no step and no problem without the trailer', () => {
    expect(stepOf(agentTrailers)).toEqual({ problems: [] });
  });

  it('rejects unknown and repeated steps', () => {
    expect(stepOf([{ key: 'Step', value: 'coding' }]).problems[0]).toMatch(/not one of/);
    expect(stepOf([{ key: 'Step', value: 'Design' }]).problems[0]).toMatch(/not one of/);
    const repeated = [
      { key: 'Step', value: 'design' },
      { key: 'Step', value: 'scaffold' },
    ];
    expect(stepOf(repeated).problems[0]).toMatch(/2 Step trailers/);
  });
});

describe('checkMessage on an issue branch', () => {
  it('accepts the matching type, the issue reference and a Step trailer', () => {
    const scaffold = message('chore(scaffold): add hooks (#1)', 'scaffold');
    expect(checkMessage(maintenance, scaffold)).toEqual([]);
    expect(checkMessage(feature, message('feat: add word lookup (#12)', 'implement'))).toEqual([]);
  });

  it('accepts a breaking change mark with or without a scope', () => {
    const plain = message('feat!: replace the reader (#12)', 'implement');
    const scoped = message('feat(reader)!: replace the reader (#12)', 'implement');
    expect(checkMessage(feature, plain)).toEqual([]);
    expect(checkMessage(feature, scoped)).toEqual([]);
  });

  it.each([
    ['feature/2-a', 'feat'],
    ['fix/2-a', 'fix'],
    ['refactor/2-a', 'refactor'],
    ['maintenance/2-a', 'chore'],
  ])('maps the issue type of %s to the commit type %s', (branchName, type) => {
    const branch = parseBranch(branchName);
    expect(checkMessage(branch, message(`${type}: do it (#2)`, 'implement'))).toEqual([]);
    const wrong = type === 'chore' ? 'feat' : 'chore';
    expect(checkMessage(branch, message(`${wrong}: do it (#2)`, 'implement'))[0]).toMatch(
      `use "${type}"`,
    );
  });

  it('rejects a type that does not match the issue type', () => {
    const problems = checkMessage(maintenance, message('feat: add hooks (#1)', 'scaffold'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/does not match the maintenance issue/);
  });

  it('rejects a missing issue reference', () => {
    expect(checkMessage(feature, message('feat: add lookup', 'implement'))).toEqual([
      'The first line must end with the issue reference (#12).',
    ]);
  });

  it('rejects an issue number that is not the branch issue', () => {
    const problems = checkMessage(feature, message('feat: add lookup (#13)', 'implement'));
    expect(problems).toEqual([
      'Issue reference #13 does not match issue #12 of branch feature/12-word-lookup.',
    ]);
  });

  it('rejects a second, different issue reference in the first line', () => {
    const problems = checkMessage(feature, message('feat: port (#13) lookup (#12)', 'implement'));
    expect(problems[0]).toMatch(/#13 does not match issue #12/);
  });

  it('rejects a message without a Step trailer', () => {
    expect(checkMessage(feature, message('feat: add lookup (#12)'))[0]).toMatch(
      /needs a "Step: <kickoff\|architect\|design\|scaffold\|implement>" trailer/,
    );
  });

  it('rejects bad Step trailers', () => {
    expect(checkMessage(feature, message('feat: add lookup (#12)', 'coding'))).toEqual([
      'Step "coding" is not one of kickoff, architect, design, scaffold, implement.',
    ]);
    const twice = message('feat: add lookup (#12)', 'implement', [
      { key: 'Step', value: 'design' },
    ]);
    expect(checkMessage(feature, twice)[0]).toMatch(/2 Step trailers/);
  });

  it('reports a header that is not Conventional Commits', () => {
    expect(checkMessage(feature, message('Add lookup (#12)', 'implement'))[0]).toMatch(
      /not a Conventional Commits header/,
    );
  });
});

describe('checkMessage on other branches', () => {
  const renovate = parseBranch('renovate/next-16.x');

  it('accepts dependency update commits without issue and Step', () => {
    const runtime = message('fix(deps): update next to 16.5.0', undefined);
    const lockFile = message('chore(deps): lock file maintenance', undefined);
    expect(checkMessage(renovate, runtime)).toEqual([]);
    expect(checkMessage(renovate, lockFile)).toEqual([]);
  });

  it('rejects other types, an issue reference or a Step trailer on Renovate branches', () => {
    expect(checkMessage(renovate, message('feat(deps): update next', undefined))[0]).toMatch(
      /fix\(deps\)/,
    );
    expect(checkMessage(renovate, message('chore: update next', undefined))[0]).toMatch(
      /fix\(deps\)/,
    );
    expect(checkMessage(renovate, message('chore(deps): update next (#4)', undefined))).toEqual([
      'Dependency update commits carry no issue reference.',
    ]);
    expect(checkMessage(renovate, message('chore(deps): update next', 'implement'))).toEqual([
      'Dependency update commits have no Step trailer.',
    ]);
  });

  it('checks nothing on scratch branches', () => {
    const scratch = parseBranch('scratch/12-reader-layout');
    expect(checkMessage(scratch, message('feat: try a layout', undefined))).toEqual([]);
    expect(checkMessage(scratch, message('chore: other issue (#99)', 'coding'))).toEqual([]);
  });

  it('only checks a Step trailer that is present on release branches and main', () => {
    const release = parseBranch('release/1.4.0');
    const start = message('chore: start the project', 'kickoff');
    expect(checkMessage(release, message('chore(release): 1.4.0', undefined))).toEqual([]);
    expect(checkMessage(release, message('chore(release): 1.4.0', 'coding'))[0]).toMatch(
      /not one of/,
    );
    expect(checkMessage(parseBranch('main'), start)).toEqual([]);
  });

  it('rejects branches outside the workflow', () => {
    const ops = parseBranch('ops/7-rotate');
    expect(checkMessage(ops, message('chore: x (#7)', 'implement'))).toEqual([
      'Branch "ops/7-rotate" is not a workflow branch.',
    ]);
  });
});

describe('checkStepFiles', () => {
  it('lets kickoff change only the brief and the reference analyses', () => {
    expect(checkStepFiles('kickoff', ['.docs/brief.md', '.docs/reference/old/a.md'])).toEqual([]);
    expect(checkStepFiles('kickoff', ['.docs/architecture.md'])[0]).toMatch(
      /Step kickoff may change only .docs\/brief.md, .docs\/reference\/\*\*; it changes .docs\/architecture.md/,
    );
    expect(checkStepFiles('kickoff', ['VERSION'])).toHaveLength(1);
  });

  it('lets architect change only the architecture and the decision records', () => {
    const allowed = ['.docs/architecture.md', '.docs/decisions/0001-metrics.md'];
    expect(checkStepFiles('architect', allowed)).toEqual([]);
    expect(checkStepFiles('architect', ['.docs/brief.md'])).toHaveLength(1);
    expect(checkStepFiles('architect', ['.docs/design/interfaces.md'])).toHaveLength(1);
    expect(checkStepFiles('architect', ['src/app/layout.tsx'])).toHaveLength(1);
  });

  it('lets design change only the design documents', () => {
    const allowed = ['.docs/design/interfaces.md', '.docs/design/a/b.png'];
    expect(checkStepFiles('design', allowed)).toEqual([]);
    expect(checkStepFiles('design', ['.docs/architecture.md'])).toHaveLength(1);
    expect(checkStepFiles('design', ['e2e/health.spec.ts'])).toHaveLength(1);
  });

  it.each(['scaffold', 'implement', undefined] as const)(
    'lets %s change everything outside .docs/',
    (step) => {
      expect(
        checkStepFiles(step, ['src/app/layout.tsx', 'Taskfile.yml', '.github/risk-rules.txt']),
      ).toEqual([]);
      expect(checkStepFiles(step, ['README.md', 'docs/notes.md'])).toEqual([]);
      const problems = checkStepFiles(step, ['src/a.ts', '.docs/brief.md', '.docs/design/x.md']);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/it changes .docs\/brief.md, .docs\/design\/x.md\.$/);
    },
  );

  it('names commits without a Step trailer', () => {
    expect(checkStepFiles(undefined, ['.docs/brief.md'])[0]).toMatch(
      /^A commit without a Step trailer may change only files outside .docs\//,
    );
  });

  it('normalizes Windows paths before matching', () => {
    expect(checkStepFiles('design', ['.docs\\design\\interfaces.md'])).toEqual([]);
    expect(checkStepFiles('scaffold', ['.docs\\brief.md'])).toHaveLength(1);
  });
});

describe('checkCommit', () => {
  it('passes a well-formed commit that stays inside its step', () => {
    const result = checkCommit(
      maintenance,
      commit({
        message: message('chore(design): define the interface (#1)', 'design'),
        files: ['.docs/design/interfaces.md'],
      }),
    );
    expect(result).toEqual({
      id: 'abc123',
      header: 'chore(design): define the interface (#1)',
      problems: [],
    });
  });

  it('reports message and step problems together', () => {
    const result = checkCommit(
      maintenance,
      commit({
        message: message('feat(scaffold): add hooks (#2)', 'scaffold'),
        files: ['lefthook.yml', '.docs/architecture.md'],
      }),
    );
    expect(result.problems).toHaveLength(3);
  });

  it('applies the code step rule to a commit with an unknown step value', () => {
    const result = checkCommit(
      feature,
      commit({ message: message('feat: x (#12)', 'coding'), files: ['.docs/brief.md'] }),
    );
    expect(result.problems).toHaveLength(2);
  });

  it('skips merges of main whatever their message and files', () => {
    const result = checkCommit(
      feature,
      commit({
        message: message("Merge branch 'main' into feature/12-word-lookup"),
        files: ['.docs/architecture.md'],
        skip: 'merges-main',
      }),
    );
    expect(result).toMatchObject({ skipped: 'merges-main', problems: [] });
  });

  it('skips the commit that starts the project', () => {
    const result = checkCommit(
      parseBranch('main'),
      commit({
        message: message('chore: start the project', 'kickoff'),
        files: ['.docs/brief.md', 'VERSION'],
        skip: 'project-start',
      }),
    );
    expect(result).toMatchObject({ skipped: 'project-start', problems: [] });
  });

  it('checks a merge of another branch like any commit', () => {
    const result = checkCommit(
      feature,
      commit({ message: message("Merge branch 'feature/13-other'"), files: ['src/a.ts'] }),
    );
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('checks neither message nor files on scratch branches', () => {
    const result = checkCommit(
      parseBranch('scratch/12-reader-layout'),
      commit({ message: message('feat: prototype'), files: ['.docs/design/x.md', 'src/a.ts'] }),
    );
    expect(result.problems).toEqual([]);
  });

  it('applies the step table on Renovate branches', () => {
    const result = checkCommit(
      parseBranch('renovate/next-16.x'),
      commit({ message: message('fix(deps): update next', undefined), files: ['.docs/brief.md'] }),
    );
    expect(result.problems).toHaveLength(1);
  });

  it('stops at the branch problem on unknown branches', () => {
    const result = checkCommit(
      parseBranch('wip'),
      commit({ message: message('chore: x', 'scaffold'), files: ['.docs/brief.md'] }),
    );
    expect(result.problems).toEqual(['Branch "wip" is not a workflow branch.']);
  });
});
