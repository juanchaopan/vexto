import { describe, expect, it, vi } from 'vitest';
import { run } from './node-tools.ts';

// Each case starts the current Node binary with a one-line program.
const node = (program: string, input?: string) =>
  run(process.execPath, ['--eval', program], input === undefined ? {} : { input });

describe('run', () => {
  it('resolves to the exit code of the command', async () => {
    await expect(node('process.exit(3)')).resolves.toBe(3);
  });

  it('writes the input to the command', async () => {
    const program =
      "let s = ''; process.stdin.on('data', (d) => (s += d));" +
      "process.stdin.on('end', () => process.exit(s === 'hello' ? 0 : 5));";
    await expect(node(program, 'hello')).resolves.toBe(0);
  });

  it('reports a command that stops reading its input as failed instead of crashing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Far more than a pipe buffers, so the write is still going when the command exits.
      await expect(node('process.exit(0)', 'x'.repeat(16 * 1024 * 1024))).resolves.toBe(1);
      expect(errors).toHaveBeenCalledWith(
        expect.stringMatching(/stopped reading its standard input/),
      );
    } finally {
      errors.mockRestore();
    }
  });
});
