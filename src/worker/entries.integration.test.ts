// Starts each entry the way the container image does, as `node src/worker/<entry>.ts`, so the
// TypeScript and its imports are known to run on Node directly, without a bundler. The collection
// job runs against a database of its own and the test bucket: in the shared test database other
// files leave preparing articles that are due, which the job would synthesize with the real model.
// With no feed due yet and no article to synthesize, a run only starts the feeds' cursors and
// removes expired rows.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isolatedDatabase, type IsolatedDatabase } from '../features/collection/testing.ts';

const workerDir = import.meta.dirname;
const started: ChildProcess[] = [];
let db: IsolatedDatabase;

beforeAll(async () => {
  db = await isolatedDatabase();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

function start(entry: string, env: Readonly<Record<string, string>> = {}) {
  const child = spawn(process.execPath, [path.join(workerDir, entry)], {
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  started.push(child);
  return child;
}

/** The log entries the process writes, in order, until it exits. */
async function* logEntries(child: ChildProcess) {
  for await (const line of createInterface({ input: child.stdout! })) {
    yield JSON.parse(line) as Record<string, unknown>;
  }
}

async function listeningPort(child: ChildProcess) {
  for await (const entry of logEntries(child)) {
    if (typeof entry.port === 'number') {
      return entry.port;
    }
  }
  throw new Error('The service exited without listening.');
}

afterEach(() => {
  for (const child of started.splice(0)) {
    child.kill();
  }
});

describe('the Cloud Run entries under plain Node', () => {
  // A fresh Node process strips the types of every module the job loads, which takes seconds
  // while the other test files run beside it.
  it('runs the collection job to a successful exit', { timeout: 30_000 }, async () => {
    const child = start('collect.ts', { DATABASE_URL: db.url });
    const exit = new Promise((resolve) => child.on('exit', resolve));
    const entries: Record<string, unknown>[] = [];
    for await (const entry of logEntries(child)) {
      entries.push(entry);
    }
    const messages = entries.map((entry) => entry.message);

    expect(entries.filter((entry) => entry.severity === 'ERROR')).toEqual([]);
    expect(await exit).toBe(0);
    expect(messages[0]).toBe('vexto-collect started.');
    expect(messages.at(-1)).toBe('vexto-collect finished.');
    expect(messages).toContain('Expired rows removed.');
  });

  it.each(['tts.ts', 'billing-guard.ts'])('serves the health check of %s', async (entry) => {
    const port = await listeningPort(start(entry));
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
