// The dependencies the Cloud Run image installs. The web application and the Cloud Run entries
// share one package.json and one pnpm-lock.yaml; the image leaves out the runtime dependencies
// only the web application uses, which scripts/worker-image.json lists, so two versions of the
// image fit in the free storage of Artifact Registry. The names come out of the manifest and of
// the lockfile's root importer alike, so `pnpm install --frozen-lockfile` still installs every
// remaining package at its locked version. dependency-cruiser keeps the Cloud Run entries from
// reaching the listed packages.
import workerImage from '../worker-image.json' with { type: 'json' };

export type PackageManifest = {
  dependencies?: Record<string, string>;
  [field: string]: unknown;
};

export const webOnlyDependencies: readonly string[] = workerImage.webOnlyDependencies;

function failOnMissing(
  webOnly: readonly string[],
  found: (name: string) => boolean,
  where: string,
) {
  const missing = webOnly.filter((name) => !found(name));
  if (missing.length > 0) {
    throw new Error(`Not runtime dependencies in ${where}: ${missing.join(', ')}`);
  }
}

/**
 * The manifest without the given web-only runtime dependencies. A listed name that is not a
 * runtime dependency fails, so the list cannot go stale unnoticed.
 */
export function workerManifest(
  manifest: PackageManifest,
  webOnly: readonly string[],
): PackageManifest {
  const runtime = manifest.dependencies ?? {};
  failOnMissing(webOnly, (name) => Object.hasOwn(runtime, name), 'package.json');
  const dependencies = Object.fromEntries(
    Object.entries(runtime).filter(([name]) => !webOnly.includes(name)),
  );
  return { ...manifest, dependencies };
}

const unquote = (key: string) => key.replace(/^'(.*)'$/, '$1');

/**
 * The lockfile without the given names in the runtime dependencies of its root importer. Only
 * pnpm's lockfile format 9.0 is read: under `importers:`, the root importer `.:` has a
 * `dependencies:` map whose entries sit six spaces deep, each followed by its deeper lines. The
 * packages only those entries need stay in the file; a frozen install skips what no importer
 * reaches. A listed name the root importer does not have fails.
 */
export function workerLockfile(lockfile: string, webOnly: readonly string[]): string {
  if (!/^lockfileVersion: '9\.0'$/m.test(lockfile)) {
    throw new Error("Expected a pnpm lockfile with lockfileVersion '9.0'.");
  }
  const removed = new Set<string>();
  const kept: string[] = [];
  let section = '';
  let importer = '';
  let group = '';
  let dropping = false;
  for (const line of lockfile.split('\n')) {
    const blank = line.trim() === '';
    const indent = line.length - line.trimStart().length;
    if (!blank && indent <= 6) {
      const key = line.trim().replace(/:$/, '');
      if (indent === 0) [section, importer, group] = [key, '', ''];
      if (indent === 2) [importer, group] = [key, ''];
      if (indent === 4) group = key;
      const rootRuntimeEntry =
        indent === 6 && section === 'importers' && importer === '.' && group === 'dependencies';
      dropping = rootRuntimeEntry && webOnly.includes(unquote(key));
      if (dropping) removed.add(unquote(key));
    }
    if (blank || !dropping) kept.push(line);
  }
  failOnMissing(webOnly, (name) => removed.has(name), 'the root importer of pnpm-lock.yaml');
  return kept.join('\n');
}
