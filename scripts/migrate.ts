// Brings the database up to the latest migration script in drizzle/. Migrations need a direct
// connection, so DATABASE_URL_UNPOOLED is used when it is set; otherwise DATABASE_URL, which is
// what a local database has. drizzle.config.ts reads DATABASE_URL, so the chosen address is
// handed to drizzle-kit under that name.
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

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    'Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set; one must point at the database to migrate.',
  );
  process.exit(1);
}

process.exitCode = await runPackageBin(
  'drizzle-kit',
  'drizzle-kit',
  ['migrate', '--config', 'drizzle.config.ts', ...process.argv.slice(2)],
  { env: { ...process.env, DATABASE_URL: databaseUrl } },
);
