// Entry of the Cloud Run job vexto-collect: one run of the collection pipeline, started by Cloud
// Scheduler or by hand. It exits 0 when the run ends normally, including when another run holds
// the lease and when single articles or feeds fail, and 1 when the run itself fails
// (.docs/design/interfaces.md). The database pool is closed before the process exits.
// Run with: node src/worker/collect.ts
import { runCollection, type CollectionDependencies } from '../features/collection/index.ts';
import { closeDatabase } from '../lib/db/client.ts';
import { errorFields, log } from '../lib/log.ts';

/** Runs the job once; tests pass the dependencies they replace, the rest are the production ones. */
export async function main(dependencies: Partial<CollectionDependencies> = {}): Promise<number> {
  const execution = process.env.CLOUD_RUN_EXECUTION;
  const startedAt = Date.now();
  log('INFO', 'vexto-collect started.', { job: 'vexto-collect', execution });
  let exitCode = 0;
  try {
    const { runId } = await runCollection(dependencies);
    log('INFO', 'vexto-collect finished.', {
      job: 'vexto-collect',
      execution,
      runId,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    log('ERROR', 'vexto-collect failed.', {
      job: 'vexto-collect',
      execution,
      durationMs: Date.now() - startedAt,
      ...errorFields(error),
    });
    exitCode = 1;
  }
  await closeDatabase();
  return exitCode;
}

if (import.meta.main) {
  process.exitCode = await main();
}
