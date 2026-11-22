// Runs the end-to-end tests tagged @smoke against an application that is already running.
// Usage: node scripts/test-smoke.ts <base-url> [--production-safe] [playwright test arguments...]
//   --production-safe  only the @smoke tests that are also tagged @production-safe
import { runPackageBin } from './lib/node-tools.ts';

const PRODUCTION_SAFE = '--production-safe';

const args = process.argv.slice(2);
const productionSafe = args.includes(PRODUCTION_SAFE);
const [baseUrl, ...playwrightArgs] = args.filter((arg) => arg !== PRODUCTION_SAFE);

const protocol = baseUrl && URL.canParse(baseUrl) ? new URL(baseUrl).protocol : '';
if (protocol !== 'http:' && protocol !== 'https:') {
  console.error(
    'Usage: task test-smoke -- <base-url> [--production-safe] [playwright test arguments]',
  );
  process.exit(2);
}

// Playwright matches --grep against the test title and its tags.
const grep = productionSafe ? '(?=.*@smoke)(?=.*@production-safe)' : '@smoke';

process.exitCode = await runPackageBin(
  '@playwright/test',
  'playwright',
  ['test', '--grep', grep, ...playwrightArgs],
  { env: { ...process.env, E2E_BASE_URL: baseUrl } },
);
