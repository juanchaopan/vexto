// Prints the risk tier (high, medium or low) of a pull request from its changed files, using a
// risk rules file such as .github/risk-rules.txt (see scripts/lib/risk.ts). CI reads the rules
// file from the target branch, so a pull request cannot lower its own tier.
// Usage: node scripts/risk-tier.ts --rules <file> [--branch <head branch>] [--files-from <file>] [files...]
// --files-from reads one path per line from a file, or from standard input when the file is `-`.
// The tier goes to standard output and the reason to standard error.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { classifyRisk, parseRiskRules } from './lib/risk.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rules: { type: 'string' },
    branch: { type: 'string' },
    'files-from': { type: 'string' },
  },
});

if (!values.rules) {
  console.error('Pass --rules <file>.');
  process.exit(1);
}

function listedFiles(source: string | undefined) {
  if (!source) {
    return [];
  }
  const text = readFileSync(source === '-' ? 0 : source, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

const rules = parseRiskRules(readFileSync(values.rules, 'utf8'));
const files = [...listedFiles(values['files-from']), ...positionals];
const { tier, reason } = classifyRisk(rules, files, values.branch);
console.error(reason);
console.log(tier);
