// Runs the end-to-end tests inside the pinned Playwright Linux container, so local runs and CI
// use the same browsers, fonts and screenshot baselines.
// Usage: node scripts/test-e2e.ts [playwright test arguments...]
//
// The repository is mounted at /work. Linux dependencies live in named volumes, so the host's
// node_modules stays untouched and later runs reuse the installed packages; the build output
// lives in an anonymous volume that is removed with the container.
import { randomBytes } from 'node:crypto';
import { readManifest, repoRoot, run } from './lib/node-tools.ts';

// The image version must equal the installed @playwright/test version; the digest pins the image.
const PLAYWRIGHT_IMAGE =
  'mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579';

const imageVersion = /:v([^-@]+)-/.exec(PLAYWRIGHT_IMAGE)?.[1];
const installedVersion = readManifest('@playwright/test').version;
if (imageVersion !== installedVersion) {
  console.error(
    `The Playwright image is v${imageVersion} but @playwright/test is ${installedVersion}; ` +
      'update the image tag and digest in scripts/test-e2e.ts together with the package.',
  );
  process.exit(1);
}

const project = readManifest().name;
const containerName = `${project}-e2e-${randomBytes(4).toString('hex')}`;

// On Linux and macOS the container hands the files it writes back to the calling user.
const ownerEnv =
  typeof process.getuid === 'function' && typeof process.getgid === 'function'
    ? ['--env', `HOST_UID=${process.getuid()}`, '--env', `HOST_GID=${process.getgid()}`]
    : [];
const ciEnv = process.env.CI ? ['--env', `CI=${process.env.CI}`] : [];
const colorEnv = process.stdout.isTTY ? ['--env', 'FORCE_COLOR=1'] : [];

const dockerArgs = [
  'run',
  '--rm',
  '--init',
  '--ipc=host',
  '--name',
  containerName,
  '--volume',
  `${repoRoot}:/work`,
  '--volume',
  `${project}-e2e-node-modules:/work/node_modules`,
  '--volume',
  `${project}-e2e-pnpm:/pnpm`,
  '--volume',
  '/work/.next',
  '--workdir',
  '/work',
  '--env',
  'E2E_CONTAINER=1',
  ...ciEnv,
  ...colorEnv,
  ...ownerEnv,
  PLAYWRIGHT_IMAGE,
  'node',
  'scripts/e2e-in-container.ts',
  ...process.argv.slice(2),
];

// An interrupted run still removes its container.
const removeContainer = () => {
  void run('docker', ['rm', '--force', containerName]);
};
process.on('SIGINT', removeContainer);
process.on('SIGTERM', removeContainer);

process.exitCode = await run('docker', dockerArgs);
