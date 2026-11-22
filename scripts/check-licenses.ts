// Fails when a runtime dependency has a license outside the policy in
// scripts/lib/license-policy.ts. Two listings are combined, because each misses packages the
// other sees in pnpm's layout:
//   license-checker-rseidelsohn --production   follows the dependency tree from package.json but
//                                              skips optional dependencies such as sharp's
//                                              @img/sharp-<platform> packages
//   pnpm licenses list --prod                  reads pnpm's lockfile and node_modules, including
//                                              the optional packages installed on this platform
// The two listings are independent, so they run at the same time.
// Usage: node scripts/check-licenses.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { judgeLicense, listingProblems, type InstalledPackage } from './lib/license-policy.ts';
import { pnpmOutput, runPackageBin, withTempDir } from './lib/node-tools.ts';

type CheckerEntry = { licenses?: string | string[] };
type PnpmEntry = { name: string; versions: string[]; license: string };

function licenseCheckerPackages(): Promise<InstalledPackage[]> {
  return withTempDir('licenses-', async (workDir) => {
    const outFile = path.join(workDir, 'licenses.json');
    const code = await runPackageBin('license-checker-rseidelsohn', 'license-checker-rseidelsohn', [
      '--production',
      '--excludePrivatePackages',
      '--json',
      '--out',
      outFile,
    ]);
    if (code !== 0) {
      throw new Error(`license-checker-rseidelsohn exited with code ${code}`);
    }
    const entries = JSON.parse(readFileSync(outFile, 'utf8')) as Record<string, CheckerEntry>;
    return Object.entries(entries).map(([id, entry]) => {
      const at = id.lastIndexOf('@');
      return { name: id.slice(0, at), version: id.slice(at + 1), license: entry.licenses ?? [] };
    });
  });
}

async function pnpmPackages(): Promise<InstalledPackage[]> {
  const output = await pnpmOutput(['licenses', 'list', '--prod', '--json']);
  const groups = JSON.parse(output) as Record<string, PnpmEntry[]>;
  return Object.values(groups).flatMap((entries) =>
    entries.flatMap((entry) =>
      entry.versions.map((version) => ({ name: entry.name, version, license: entry.license })),
    ),
  );
}

function licenseText(license: InstalledPackage['license']) {
  return typeof license === 'string' ? license : license.join(' AND ') || 'none';
}

const listings = await Promise.all([licenseCheckerPackages(), pnpmPackages()]);
const packages = new Map<string, InstalledPackage>();
for (const pkg of listings.flat()) {
  packages.set(`${pkg.name}@${pkg.version}`, pkg);
}
const listed = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));

const problems = listingProblems(listed);
const exceptions: string[] = [];
for (const pkg of listed) {
  const verdict = judgeLicense(pkg);
  const line = `${pkg.name}@${pkg.version}: ${licenseText(pkg.license)}`;
  if (verdict === 'exception') {
    exceptions.push(line);
  } else if (verdict === 'rejected') {
    problems.push(`License not allowed: ${line}`);
  }
}

console.log(`Checked ${listed.length} runtime packages.`);
exceptions.forEach((line) => console.log(`  allowed by exception: ${line}`));
problems.forEach((problem) => console.error(problem));
process.exitCode = problems.length > 0 ? 1 : 0;
