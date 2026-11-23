import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './node-tools.ts';
import {
  webOnlyDependencies,
  workerLockfile,
  workerManifest,
  type PackageManifest,
} from './worker-dependencies.ts';

const manifest: PackageManifest = {
  name: 'app',
  type: 'module',
  dependencies: { '@clerk/nextjs': '1.0.0', next: '1.0.0', zod: '1.0.0' },
  devDependencies: { vitest: '1.0.0' },
};

// Two YAML documents as pnpm writes them: the package manager's own importer first, then the
// project's, with a dependency of the same name under devDependencies.
const lockfile = `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 1.0.0
        version: 1.0.0

---
lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@clerk/nextjs':
        specifier: 1.0.0
        version: 1.0.0(next@1.0.0)
      next:
        specifier: 1.0.0
        version: 1.0.0
      zod:
        specifier: 1.0.0
        version: 1.0.0
    devDependencies:
      vitest:
        specifier: 1.0.0
        version: 1.0.0(next@1.0.0)

packages:

  next@1.0.0:
    resolution: {integrity: sha512-a}

  zod@1.0.0:
    resolution: {integrity: sha512-b}
`;

const readRepoFile = (name: string) => readFileSync(path.join(repoRoot, name), 'utf8');

describe('workerManifest', () => {
  it('drops the web-only runtime dependencies and keeps everything else', () => {
    expect(workerManifest(manifest, ['@clerk/nextjs', 'next'])).toEqual({
      name: 'app',
      type: 'module',
      dependencies: { zod: '1.0.0' },
      devDependencies: { vitest: '1.0.0' },
    });
    expect(manifest.dependencies).toHaveProperty('next');
  });

  it('fails on a listed name that is not a runtime dependency', () => {
    expect(() => workerManifest(manifest, ['next', 'vitest', 'zustand'])).toThrow(
      'Not runtime dependencies in package.json: vitest, zustand',
    );
  });
});

describe('workerLockfile', () => {
  it('drops the entries from the root importer and leaves the rest of the file alone', () => {
    const expected = lockfile.replace(
      `      '@clerk/nextjs':
        specifier: 1.0.0
        version: 1.0.0(next@1.0.0)
      next:
        specifier: 1.0.0
        version: 1.0.0
`,
      '',
    );

    expect(workerLockfile(lockfile, ['@clerk/nextjs', 'next'])).toBe(expected);
  });

  it('fails on a listed name the root importer has only as a development dependency', () => {
    expect(() => workerLockfile(lockfile, ['next', 'vitest'])).toThrow(
      'Not runtime dependencies in the root importer of pnpm-lock.yaml: vitest',
    );
  });

  it('refuses a lockfile format it does not know', () => {
    expect(() => workerLockfile(lockfile.replaceAll("'9.0'", "'10.0'"), ['next'])).toThrow(
      "Expected a pnpm lockfile with lockfileVersion '9.0'.",
    );
  });
});

describe('scripts/worker-image.json', () => {
  it('lists only runtime dependencies of the repository manifest and lockfile', () => {
    const repoManifest = JSON.parse(readRepoFile('package.json')) as PackageManifest;

    const image = workerManifest(repoManifest, webOnlyDependencies);
    const imageLockfile = workerLockfile(readRepoFile('pnpm-lock.yaml'), webOnlyDependencies);

    expect(webOnlyDependencies.length).toBeGreaterThan(0);
    expect(Object.keys(image.dependencies ?? {}).length).toBeGreaterThan(0);
    for (const name of webOnlyDependencies) {
      expect(image.dependencies).not.toHaveProperty(name);
    }
    expect(imageLockfile).not.toMatch(/^ {6}next:$/m);
  });
});
