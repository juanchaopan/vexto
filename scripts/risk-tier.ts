// Prints the risk tier (high, medium or low) of a pull request from its changed files, using a
// risk rules file such as .github/risk-rules.txt (see scripts/lib/risk.ts). CI runs this script
// and reads the rules file from the target branch, so a pull request's edits to either take
// effect only once it is merged; a pull request that edits the risk workflow itself runs its own
// workflow version instead (see .github/workflows/risk.yml).
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
