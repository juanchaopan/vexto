// Branch names of the workflow and what each one says about the work on it.
//   <type>/<number>-<short-name>   issue branch; type is feature, fix, refactor or maintenance
//   scratch/<number>-<short-name>  prototypes and experiments of an issue
//   release/<version>              a release
//   renovate/...                   dependency updates opened by Renovate
//   main                           the default branch
// Ops and spike issues have no pull requests, so they have no issue branch kind.

const issueTypes = ['feature', 'fix', 'refactor', 'maintenance'] as const;
export type IssueType = (typeof issueTypes)[number];

/** The Conventional Commits type that commits and pull requests of each issue type use. */
export const commitTypeOfIssue: Record<IssueType, string> = {
  feature: 'feat',
  fix: 'fix',
  refactor: 'refactor',
  maintenance: 'chore',
};

export type Branch =
  | { kind: 'issue'; name: string; issueType: IssueType; issue: number; shortName: string }
  | { kind: 'scratch'; name: string; issue: number; shortName: string }
  | { kind: 'release'; name: string; version: string }
  | { kind: 'renovate'; name: string }
  | { kind: 'main'; name: string }
  | { kind: 'unknown'; name: string };

const shortNamePattern = '[a-z0-9]+(?:-[a-z0-9]+)*';
const issueBranch = new RegExp(`^(${issueTypes.join('|')})/([1-9]\\d*)-(${shortNamePattern})$`);
const scratchBranch = new RegExp(`^scratch/([1-9]\\d*)-(${shortNamePattern})$`);
const releaseBranch = /^release\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const renovateBranch = /^renovate\/.+$/;

/** Tells which kind of branch a name is; names outside the workflow are `unknown`. */
export function parseBranch(rawName: string): Branch {
  const name = rawName.trim().replace(/^refs\/heads\//, '');
  const issue = issueBranch.exec(name);
  if (issue) {
    return {
      kind: 'issue',
      name,
      issueType: issue[1] as IssueType,
      issue: Number(issue[2]),
      shortName: issue[3],
    };
  }
  const scratch = scratchBranch.exec(name);
  if (scratch) {
    return { kind: 'scratch', name, issue: Number(scratch[1]), shortName: scratch[2] };
  }
  const release = releaseBranch.exec(name);
  if (release) {
    return { kind: 'release', name, version: release[1] };
  }
  if (renovateBranch.test(name)) {
    return { kind: 'renovate', name };
  }
  if (name === 'main') {
    return { kind: 'main', name };
  }
  return { kind: 'unknown', name };
}

export const branchNamingHelp =
  'Branch names: <feature|fix|refactor|maintenance>/<issue>-<short-name>, ' +
  'scratch/<issue>-<short-name>, release/<version>, renovate/..., main.';
