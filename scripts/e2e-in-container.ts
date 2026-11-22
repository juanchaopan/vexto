// Runs inside the Playwright container that scripts/test-e2e.ts starts: installs the Linux
// dependencies, builds the application and runs Playwright, which starts the built application
// on a free port and stops it when the tests end.
// Usage: node scripts/e2e-in-container.ts [playwright test arguments...]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { freePort, readManifest, run, runPackageBin } from './lib/node-tools.ts';

if (process.env.E2E_CONTAINER !== '1') {
  console.error('This script runs inside the Playwright container; use `task test-e2e`.');
  process.exit(1);
}

// Both directories sit in the named volume mounted at /pnpm, so later runs reuse them.
const pnpmPrefix = '/pnpm/tool';
const pnpmStore = '/pnpm/store';
const pnpm = path.join(pnpmPrefix, 'bin', 'pnpm');
const pnpmVersion = readManifest().packageManager?.replace(/^pnpm@/, '');

const env = {
  ...process.env,
  PATH: `${path.join(pnpmPrefix, 'bin')}:${process.env.PATH ?? ''}`,
  NEXT_TELEMETRY_DISABLED: '1',
};

async function mustRun(command: string, args: readonly string[]) {
  const code = await run(command, args, { env });
  if (code !== 0) {
    process.exit(code);
  }
}

function installedPnpmVersion() {
  return existsSync(pnpm) ? execFileSync(pnpm, ['--version'], { encoding: 'utf8' }).trim() : '';
}

// Files written into the mounted repository belong to root inside the container; hand them back
// to the calling user when the host is Linux or macOS.
async function handBackOutputs() {
  const { HOST_UID: uid, HOST_GID: gid } = process.env;
  const outputs = ['test-results', 'playwright-report', 'e2e'].filter((dir) => existsSync(dir));
  if (uid && gid && outputs.length > 0) {
    await run('chown', ['-R', `${uid}:${gid}`, ...outputs]);
  }
}

if (!pnpmVersion) {
  console.error('package.json has no packageManager pnpm version.');
  process.exit(1);
}
if (installedPnpmVersion() !== pnpmVersion) {
  await mustRun('npm', ['install', '--global', '--prefix', pnpmPrefix, `pnpm@${pnpmVersion}`]);
}
await mustRun(pnpm, [
  'install',
  '--frozen-lockfile',
  '--store-dir',
  pnpmStore,
  '--config.confirm-modules-purge=false',
]);
await mustRun(pnpm, ['exec', 'next', 'build']);

const testEnv = { ...env, E2E_PORT: String(await freePort()) };
const playwrightArgs = ['test', ...process.argv.slice(2)];
const code = await runPackageBin('@playwright/test', 'playwright', playwrightArgs, {
  env: testEnv,
});
await handBackOutputs();
process.exit(code);
