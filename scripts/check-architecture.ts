// Checks the dependency rules in .dependency-cruiser.cjs. A run that analyses no modules fails,
// so a wrong path or a broken configuration cannot pass silently.
// Usage: node scripts/check-architecture.ts [paths...]   (default: src)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runPackageBin, withTempDir } from './lib/node-tools.ts';

type CruiseSummary = {
  totalCruised: number;
  error: number;
  warn: number;
};

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : ['src'];

process.exitCode = await withTempDir('depcruise-', async (workDir) => {
  const resultFile = path.join(workDir, 'result.json');
  const cruiseCode = await runPackageBin('dependency-cruiser', 'depcruise', [
    '--config',
    '.dependency-cruiser.cjs',
    '--output-type',
    'json',
    '--output-to',
    resultFile,
    ...targets,
  ]);
  if (!existsSync(resultFile)) {
    console.error(`dependency-cruiser stopped without a result (exit code ${cruiseCode}).`);
    return 1;
  }

  const { summary } = JSON.parse(readFileSync(resultFile, 'utf8')) as { summary: CruiseSummary };
  if (summary.totalCruised === 0) {
    console.error(`dependency-cruiser analysed 0 modules in ${targets.join(', ')}.`);
    return 1;
  }

  await runPackageBin('dependency-cruiser', 'depcruise-fmt', [
    '--output-type',
    'err-long',
    resultFile,
  ]);
  console.log(
    `Analysed ${summary.totalCruised} modules: ${summary.error} errors, ${summary.warn} warnings.`,
  );
  return summary.error > 0 ? 1 : 0;
});
