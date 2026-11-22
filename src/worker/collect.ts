// Entry of the Cloud Run job vexto-collect: one run of the collection pipeline, started by Cloud
// Scheduler or by hand. It exits 0 when the run ends normally, including when single articles
// or feeds fail, and 1 when the run itself fails (.docs/design/interfaces.md).
// Run with: node src/worker/collect.ts
import { runCollection } from '../features/collection/index.ts';
import { errorFields, log } from '../lib/log.ts';

export async function main(): Promise<number> {
  const execution = process.env.CLOUD_RUN_EXECUTION;
  const startedAt = Date.now();
  log('INFO', 'vexto-collect started.', { job: 'vexto-collect', execution });
  try {
    await runCollection();
  } catch (error) {
    log('ERROR', 'vexto-collect failed.', {
      job: 'vexto-collect',
      execution,
      durationMs: Date.now() - startedAt,
      ...errorFields(error),
    });
    return 1;
  }
  log('INFO', 'vexto-collect finished.', {
    job: 'vexto-collect',
    execution,
    durationMs: Date.now() - startedAt,
  });
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
