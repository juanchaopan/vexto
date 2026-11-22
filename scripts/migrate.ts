// Brings the database at DATABASE_URL up to the latest migration script in drizzle/.
// Usage: node scripts/migrate.ts [drizzle-kit migrate arguments...]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, runPackageBin } from './lib/node-tools.ts';

// drizzle-kit lists the generated scripts in this journal; without it there is nothing to run.
const journal = path.join(repoRoot, 'drizzle', 'meta', '_journal.json');

if (!existsSync(journal)) {
  console.log(
    'No migration scripts yet (drizzle/meta/_journal.json does not exist); nothing to do.',
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set; it must point at the database to migrate.');
  process.exit(1);
}

process.exitCode = await runPackageBin('drizzle-kit', 'drizzle-kit', [
  'migrate',
  '--config',
  'drizzle.config.ts',
  ...process.argv.slice(2),
]);
