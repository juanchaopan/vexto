// Workflow rules for commit messages and for the files each step may change. Format and length
// of the header are commitlint's job; these rules cover what commitlint cannot know: the branch
// the commit belongs to, the issue it works on and the step it was made in.
import { commitTypeOfIssue, type Branch } from './branches.ts';
import { matchesAny, matchesPattern, normalizePath } from './path-patterns.ts';

export const steps = ['kickoff', 'architect', 'design', 'scaffold', 'implement'] as const;
export type Step = (typeof steps)[number];

export type Trailer = { key: string; value: string };

export type CommitMessage = {
  header: string;
  trailers: readonly Trailer[];
};

export type ParsedHeader = {
  type: string;
  scope?: string;
  breaking: boolean;
  subject: string;
};

// Groups: type, scope, breaking mark, subject.
const headerPattern = /^([a-z]+)(?:\(([^()\r\n]+)\))?(!)?: (\S.*)$/;
const trailingIssueRef = /\s\(#(\d+)\)$/;
const anyIssueRef = /\(#(\d+)\)/g;

/** Splits a Conventional Commits header; null when the header does not have that shape. */
export function parseHeader(header: string): ParsedHeader | null {
  const match = headerPattern.exec(header.trim());
  if (!match) {
    return null;
  }
  const [, type, scope, breaking, subject] = match;
  return { type, scope, breaking: breaking === '!', subject };
}

/** The issue number a header ends with, written as ` (#<number>)`. */
export function trailingIssueOf(header: string): number | null {
  const match = trailingIssueRef.exec(header.trim());
  return match ? Number(match[1]) : null;
}

function issueRefsOf(header: string) {
  return [...header.matchAll(anyIssueRef)].map((match) => Number(match[1]));
}

/** Checks the type and issue reference of a header on an issue branch. */
export function checkIssueHeader(
  header: string,
  branch: Extract<Branch, { kind: 'issue' }>,
): string[] {
  const parsed = parseHeader(header);
  if (!parsed) {
    return [`"${header}" is not a Conventional Commits header "<type>[(scope)][!]: <subject>".`];
  }
  const problems: string[] = [];
  const expectedType = commitTypeOfIssue[branch.issueType];
  if (parsed.type !== expectedType) {
    problems.push(
      `Type "${parsed.type}" does not match the ${branch.issueType} issue of branch ` +
        `${branch.name}; use "${expectedType}".`,
    );
  }
  if (trailingIssueOf(header) === null) {
    problems.push(`The first line must end with the issue reference (#${branch.issue}).`);
  }
  const otherIssues = issueRefsOf(header).filter((issue) => issue !== branch.issue);
  if (otherIssues.length > 0) {
    problems.push(
      `Issue reference ${otherIssues.map((issue) => `#${issue}`).join(', ')} does not match ` +
        `issue #${branch.issue} of branch ${branch.name}.`,
    );
  }
  return problems;
}

/** The Step trailer of a message, with problems when it is repeated or has an unknown value. */
export function stepOf(trailers: readonly Trailer[]): { step?: Step; problems: string[] } {
  const values = trailers
    .filter((trailer) => trailer.key.toLowerCase() === 'step')
    .map((trailer) => trailer.value.trim());
  if (values.length === 0) {
    return { problems: [] };
  }
  if (values.length > 1) {
    return { problems: [`The message has ${values.length} Step trailers; it may have one.`] };
  }
  const [value] = values;
  if (!(steps as readonly string[]).includes(value)) {
    return { problems: [`Step "${value}" is not one of ${steps.join(', ')}.`] };
  }
  return { step: value as Step, problems: [] };
}

function checkRenovateMessage(message: CommitMessage) {
  const problems: string[] = [];
  const parsed = parseHeader(message.header);
  if (!parsed || !['fix', 'chore'].includes(parsed.type) || parsed.scope !== 'deps') {
    problems.push('Dependency update commits start with "fix(deps): " or "chore(deps): ".');
  }
  if (issueRefsOf(message.header).length > 0) {
    problems.push('Dependency update commits carry no issue reference.');
  }
  if (message.trailers.some((trailer) => trailer.key.toLowerCase() === 'step')) {
    problems.push('Dependency update commits have no Step trailer.');
  }
  return problems;
}

/**
 * Checks a commit message against the rules of the branch it is on. Scratch branches only need
 * the format commitlint checks, so they have no rules here.
 */
export function checkMessage(branch: Branch, message: CommitMessage): string[] {
  switch (branch.kind) {
    case 'issue': {
      const { step, problems } = stepOf(message.trailers);
      const missing =
        step === undefined && problems.length === 0
          ? [`The message needs a "Step: <${steps.join('|')}>" trailer in its last paragraph.`]
          : [];
      return [...checkIssueHeader(message.header, branch), ...problems, ...missing];
    }
    case 'renovate':
      return checkRenovateMessage(message);
    case 'scratch':
      return [];
    case 'release':
    case 'main':
      return stepOf(message.trailers).problems;
    case 'unknown':
      return [`Branch "${branch.name}" is not a workflow branch.`];
  }
}

const docsPattern = '.docs/**';

/** Files each step may change. Commits without a Step trailer are code commits. */
export const stepFiles: Record<Step, readonly string[] | 'outside-docs'> = {
  kickoff: ['.docs/brief.md', '.docs/reference/**'],
  architect: ['.docs/architecture.md', '.docs/decisions/**'],
  design: ['.docs/design/**'],
  scaffold: 'outside-docs',
  implement: 'outside-docs',
};

function describeStep(step: Step | undefined) {
  const allowed = step ? stepFiles[step] : 'outside-docs';
  const files = allowed === 'outside-docs' ? 'files outside .docs/' : allowed.join(', ');
  return `${step ? `Step ${step}` : 'A commit without a Step trailer'} may change only ${files}`;
}

export function isAllowedForStep(step: Step | undefined, filePath: string) {
  const allowed = step ? stepFiles[step] : 'outside-docs';
  return allowed === 'outside-docs'
    ? !matchesPattern(filePath, docsPattern)
    : matchesAny(filePath, allowed);
}

/** Lists the changed files the step may not change, with the rule they break. */
export function checkStepFiles(step: Step | undefined, files: readonly string[]): string[] {
  const forbidden = files.map(normalizePath).filter((file) => !isAllowedForStep(step, file));
  if (forbidden.length === 0) {
    return [];
  }
  return [`${describeStep(step)}; it changes ${forbidden.join(', ')}.`];
}

/**
 * Commits the checks pass over:
 *   merges-main    a merge commit that brings main into the branch
 *   project-start  a commit without parents, the first commit of the project on main
 */
export type SkipReason = 'merges-main' | 'project-start';

export type CommitToCheck = {
  /** Commit id, or a label for the commit being written in the commit-msg hook. */
  id: string;
  message: CommitMessage;
  files: readonly string[];
  skip?: SkipReason;
};

export type CommitResult = {
  id: string;
  header: string;
  skipped?: SkipReason;
  problems: string[];
};

/** Applies the message rules and the step table to one commit on a branch. */
export function checkCommit(branch: Branch, commit: CommitToCheck): CommitResult {
  const base = { id: commit.id, header: commit.message.header };
  if (commit.skip) {
    return { ...base, skipped: commit.skip, problems: [] };
  }
  if (branch.kind === 'scratch') {
    return { ...base, problems: [] };
  }
  const messageProblems = checkMessage(branch, commit.message);
  if (branch.kind === 'unknown') {
    return { ...base, problems: messageProblems };
  }
  const { step } = stepOf(commit.message.trailers);
  return { ...base, problems: [...messageProblems, ...checkStepFiles(step, commit.files)] };
}
