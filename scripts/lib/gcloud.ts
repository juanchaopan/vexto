// Runs the gcloud CLI. On Windows gcloud is a .cmd script, which starts only through a shell,
// so there the arguments go to the shell as one command line; every argument is then limited to
// characters the shell reads as part of one plain word. Values that may be secret never become
// arguments: they go to the command's standard input.
import { spawn } from 'node:child_process';

const plainWindowsArgument = /^[A-Za-z0-9_@+=:,./-]+$/;

export type GcloudOptions = {
  /** Working directory; relative paths in the arguments are read from here. */
  cwd?: string;
  /** Written to standard input, for values such as secrets. */
  input?: string;
  /** Keep standard output in memory and resolve to it instead of showing it. */
  captureOutput?: boolean;
};

export type GcloudResult = { code: number; output: string };

function spawnGcloud(args: readonly string[], options: GcloudOptions) {
  const stdio: ('ignore' | 'pipe' | 'inherit')[] = [
    options.input === undefined ? 'ignore' : 'pipe',
    options.captureOutput ? 'pipe' : 'inherit',
    'inherit',
  ];
  if (process.platform !== 'win32') {
    return spawn('gcloud', args, { cwd: options.cwd, stdio });
  }
  if (!args.every((arg) => plainWindowsArgument.test(arg))) {
    throw new Error('A gcloud argument has characters the Windows shell would read itself.');
  }
  return spawn(['gcloud', ...args].join(' '), { cwd: options.cwd, stdio, shell: true });
}

/**
 * Runs gcloud and resolves to its exit code and, with captureOutput, its standard output. The
 * output is never printed here, since it may hold a secret.
 */
export function gcloud(args: readonly string[], options: GcloudOptions = {}) {
  return new Promise<GcloudResult>((resolve, reject) => {
    const child = spawnGcloud(args, options);
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), output: Buffer.concat(chunks).toString('utf8') });
    });
    if (options.input !== undefined && child.stdin) {
      // A command that exits before reading its input is reported through its exit code.
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.input);
    }
  });
}
