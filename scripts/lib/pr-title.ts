// Pull request title rules. The title becomes the squash commit on main, so it follows the same
// header rules as the branch's commits and the same 100-character limit commitlint applies.
import type { Branch } from './branches.ts';
import { checkIssueHeader, parseHeader } from './commit-rules.ts';

export const maxTitleLength = 100;

/** Problems with a pull request title for the branch it comes from; empty when it is right. */
export function checkPrTitle(title: string, branch: Branch): string[] {
  const length = [...title].length;
  const lengthProblems =
    length > maxTitleLength
      ? [`The title has ${length} characters; at most ${maxTitleLength} are allowed.`]
      : [];
  return [...lengthProblems, ...checkTitleForBranch(title, branch)];
}

function checkTitleForBranch(title: string, branch: Branch): string[] {
  switch (branch.kind) {
    case 'issue':
      return checkIssueHeader(title, branch);
    case 'release': {
      const expected = `chore(release): ${branch.version}`;
      return title === expected ? [] : [`A release pull request is titled "${expected}".`];
    }
    case 'renovate': {
      const parsed = parseHeader(title);
      const valid =
        parsed !== null &&
        ['fix', 'chore'].includes(parsed.type) &&
        parsed.scope === 'deps' &&
        !parsed.breaking &&
        !/\(#\d+\)/.test(title);
      return valid
        ? []
        : ['A dependency update is titled "fix(deps): ..." or "chore(deps): ..." with no issue.'];
    }
    case 'scratch':
    case 'main':
    case 'unknown':
      return [`Branch "${branch.name}" is not merged through a pull request.`];
  }
}
