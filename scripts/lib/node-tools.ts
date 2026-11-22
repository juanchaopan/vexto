import { exec, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/** Root of the repository, the working directory of every command the scripts start. */
export const repoRoot = path.resolve(import.meta.dirname, '..', '..');

type RunOptions = {
  env?: NodeJS.ProcessEnv;
  /** Written to the command's standard input; without it the command reads the terminal. */
  input?: string;
};

type PackageManifest = {
  name: string;
  version: string;
  packageManager?: string;
  bin?: string | Record<string, string>;
};

const execAsync = promisify(exec);

function spawnOptions(options: RunOptions): SpawnOptions {
  return {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: [options.input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
  };
}

// A command that exits or closes its standard input before reading all of the input makes the
// write fail (EPIPE on POSIX, EOF on Windows). The failure is reported as the command failing,
// with the error code only, since the input may hold a secret. The exit code is taken on `close`,
// which comes after the input stream's error.
function exitCodeOf(child: ChildProcess, input: string | undefined) {
  return new Promise<number>((resolve, reject) => {
    let inputError: NodeJS.ErrnoException | undefined;
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const exitCode = code ?? (signal ? 1 : 0);
      if (inputError) {
        console.error(
          `The command stopped reading its standard input (${inputError.code ?? inputError.message}).`,
        );
        resolve(exitCode === 0 ? 1 : exitCode);
        return;
      }
      resolve(exitCode);
    });
    if (input !== undefined && child.stdin) {
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        inputError ??= error;
      });
      child.stdin.end(input);
    }
  });
}

/** Runs a command with the terminal attached and resolves to its exit code. */
export function run(command: string, args: readonly string[], options: RunOptions = {}) {
  return exitCodeOf(spawn(command, args, spawnOptions(options)), options.input);
}

// pnpm is a .cmd shim on Windows, which only starts through a shell, so pnpm commands go to the
// shell as one command line. The arguments are fixed names and flags, or values checked to be
// plain names by the caller.
function pnpmCommandLine(args: readonly string[]) {
  return ['pnpm', ...args].join(' ');
}

/** Runs pnpm with the terminal attached and resolves to its exit code. */
export function runPnpm(args: readonly string[], options: RunOptions = {}) {
  const child = spawn(pnpmCommandLine(args), { ...spawnOptions(options), shell: true });
  return exitCodeOf(child, options.input);
}

/** Runs pnpm and resolves to its standard output; a failing command rejects. */
export async function pnpmOutput(args: readonly string[]) {
  const { stdout } = await execAsync(pnpmCommandLine(args), {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
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

/** Calls `work` with a new temporary directory and removes the directory when it settles. */
export async function withTempDir<T>(prefix: string, work: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
