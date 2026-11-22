// Risk tier of a pull request from the files it changes, using the rules in
// .github/risk-rules.txt. The rules file has a [high] and a [low] section with one path pattern
// per line (see path-patterns.ts); `#` starts a comment line.
//   high    any changed file matches a high pattern, or the branch is a release branch
//   low     every changed file matches a low pattern
//   medium  everything else, including a change with no files
// High wins over low, so a file matching both makes the change high.
import { parseBranch } from './branches.ts';
import { matchesAny } from './path-patterns.ts';

export type RiskTier = 'high' | 'medium' | 'low';

export type RiskRules = { high: string[]; low: string[] };

export function parseRiskRules(text: string): RiskRules {
  const rules: RiskRules = { high: [], low: [] };
  let section: keyof RiskRules | undefined;
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const header = /^\[(high|low)\]$/.exec(line);
    if (header) {
      section = header[1] as keyof RiskRules;
      return;
    }
    if (line.startsWith('[')) {
      throw new Error(`Line ${index + 1}: unknown section ${line}; use [high] or [low].`);
    }
    if (!section) {
      throw new Error(`Line ${index + 1}: pattern "${line}" comes before a [high] or [low] line.`);
    }
    rules[section].push(line);
  });
  if (rules.high.length === 0 || rules.low.length === 0) {
    throw new Error('The risk rules need at least one [high] and one [low] pattern.');
  }
  return rules;
}

export type RiskResult = { tier: RiskTier; reason: string };

export function classifyRisk(
  rules: RiskRules,
  files: readonly string[],
  branchName?: string,
): RiskResult {
  if (branchName && parseBranch(branchName).kind === 'release') {
    return { tier: 'high', reason: `${branchName} is a release branch.` };
  }
  const highFiles = files.filter((file) => matchesAny(file, rules.high));
  if (highFiles.length > 0) {
    return { tier: 'high', reason: `High-risk files: ${highFiles.join(', ')}.` };
  }
  if (files.length === 0) {
    return { tier: 'medium', reason: 'No changed files were given.' };
  }
  const otherFiles = files.filter((file) => !matchesAny(file, rules.low));
  if (otherFiles.length === 0) {
    return { tier: 'low', reason: 'Every changed file is low risk.' };
  }
  return { tier: 'medium', reason: `Neither high nor low risk: ${otherFiles.join(', ')}.` };
}
