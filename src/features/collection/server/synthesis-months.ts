// The monthly tally of article synthesis (.docs/design/data.md, synthesis_cpu_months): one row
// per UTC month with the seconds synthesis ran, to a tenth of a second. Every synthesis, whether
// it succeeded or failed, adds its seconds when it ends.
import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../../../lib/db/client.ts';
import { synthesisCpuMonths } from './schema.ts';

/** The seconds synthesis ran in the month (YYYY-MM-01); 0 for a month with none yet. */
export async function synthesisSecondsOf(executor: Executor, month: string): Promise<number> {
  const [row] = await executor
    .select({ seconds: synthesisCpuMonths.synthesisSeconds })
    .from(synthesisCpuMonths)
    .where(eq(synthesisCpuMonths.month, month));
  return row?.seconds ?? 0;
}

export async function addSynthesisSeconds(
  executor: Executor,
  month: string,
  seconds: number,
): Promise<void> {
  const tenths = Math.max(0, Math.round(seconds * 10)) / 10;
  await executor
    .insert(synthesisCpuMonths)
    .values({ month, synthesisSeconds: tenths })
    .onConflictDoUpdate({
      target: synthesisCpuMonths.month,
      set: {
        synthesisSeconds: sql`${synthesisCpuMonths.synthesisSeconds} + excluded.synthesis_seconds`,
      },
    });
}
