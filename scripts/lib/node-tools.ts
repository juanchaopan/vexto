import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

/** Root of the repository, the working directory of every command the scripts start. */
export const repoRoot = path.resolve(import.meta.dirname, '..', '..');

type RunOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

type PackageManifest = {
  name: string;
  version: string;
  packageManager?: string;
  bin?: string | Record<string, string>;
};

/** Runs a command with the terminal attached and resolves to its exit code. */
export function run(command: string, args: readonly string[], options: RunOptions = {}) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** Reads package.json of the repository, or of an installed package when a name is given. */
export function readManifest(packageName?: string): PackageManifest {
  const manifestPath = packageName
    ? path.join(repoRoot, 'node_modules', packageName, 'package.json')
    : path.join(repoRoot, 'package.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
}

/**
 * Runs an installed package's command with the current Node binary. Starting the entry file
 * directly avoids the shell wrappers in node_modules/.bin, which differ between Windows and POSIX.
 */
export function runPackageBin(
  packageName: string,
  binName: string,
  args: readonly string[],
  options: RunOptions = {},
) {
  const { bin } = readManifest(packageName);
  const entry = typeof bin === 'string' ? bin : bin?.[binName];
  if (!entry) {
    throw new Error(`${packageName} has no "${binName}" command`);
  }
  const entryPath = path.join(repoRoot, 'node_modules', packageName, entry);
  return run(process.execPath, [entryPath, ...args], options);
}

/** A TCP port on the loopback interface that is free at the moment of the call. */
export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No free port was assigned'))));
    });
  });
}
