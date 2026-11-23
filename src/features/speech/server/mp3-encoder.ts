// MP3 encoding with the lame program the Cloud Run image installs (.docs/architecture.md, MP3 编码).
// lame is a system program, not a library of this project: it is started with its arguments as a
// list, never through a shell, reads the PCM on standard input and writes the MP3 to standard
// output. What it prints on standard error is kept only to explain a failure.
import { spawn } from 'node:child_process';
import { lameArguments, type Mp3Settings } from '../domain/lame-arguments.ts';

/** Encodes 16-bit little-endian mono PCM at the given sample rate into an MP3. */
export type Mp3Encoder = (pcm: Uint8Array, sampleRateHz: number) => Promise<Uint8Array>;

/** What every MP3 is written with; the input rate comes with each PCM. */
export type Mp3Output = Omit<Mp3Settings, 'inputSampleRateHz'>;

/** How much of lame's standard error a failure keeps. */
const STDERR_LIMIT = 2000;

export function lameEncoder(output: Mp3Output, command = 'lame'): Mp3Encoder {
  return (pcm, sampleRateHz) =>
    new Promise((resolve, reject) => {
      const args = lameArguments({ ...output, inputSampleRateHz: sampleRateHz });
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let errorText = '';
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => {
        errorText = (errorText + chunk.toString('utf8')).slice(-STDERR_LIMIT);
      });
      // lame may exit before it has read everything, which ends standard input with EPIPE; the
      // exit code reports that failure.
      child.stdin.on('error', () => {});
      child.on('error', (error) => reject(new Error(`lame could not start: ${error.message}`)));
      child.on('close', (code, signal) => {
        if (code === 0) {
          resolve(new Uint8Array(Buffer.concat(chunks)));
          return;
        }
        const reason = signal ? `was stopped by ${signal}` : `exited with code ${code}`;
        reject(new Error(`lame ${reason}: ${errorText.trim()}`));
      });
      child.stdin.end(pcm);
    });
}
