// Rewrites package.json and pnpm-lock.yaml in a directory into the dependencies the Cloud Run
// image installs: the same files without the web-only runtime dependencies in
// scripts/worker-image.json (see scripts/lib/worker-dependencies.ts). worker.Dockerfile runs it
// on its own copies before installing.
// Usage: node scripts/worker-dependencies.ts <directory>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  webOnlyDependencies,
  workerLockfile,
  workerManifest,
  type PackageManifest,
} from './lib/worker-dependencies.ts';

const [directory] = process.argv.slice(2);
if (!directory) {
  console.error('Usage: node scripts/worker-dependencies.ts <directory>');
  process.exit(2);
}

const manifestFile = path.join(directory, 'package.json');
const lockfileFile = path.join(directory, 'pnpm-lock.yaml');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as PackageManifest;
const lockfile = readFileSync(lockfileFile, 'utf8');

writeFileSync(
  manifestFile,
  `${JSON.stringify(workerManifest(manifest, webOnlyDependencies), null, 2)}\n`,
);
writeFileSync(lockfileFile, workerLockfile(lockfile, webOnlyDependencies));
