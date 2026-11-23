// What the collection job does with an article that waits for synthesis
// (.docs/design/rules.md, 合成预算 and 失败和重试). Synthesis is counted by UTC calendar month:
// once the month's vCPU-seconds or GiB-seconds reach the budget, no new synthesis starts and the
// article waits for the next month without using an attempt.

export type SynthesisUsage = { vcpuSeconds: number; gibSeconds: number };

/** Whether either measure of the month's usage has reached its budget. */
export function budgetReached(usage: SynthesisUsage, budget: SynthesisUsage): boolean {
  return usage.vcpuSeconds >= budget.vcpuSeconds || usage.gibSeconds >= budget.gibSeconds;
}

/** The UTC month of a moment, as the first day of that month (YYYY-MM-01). */
export function utcMonthOf(time: Date): string {
  const month = String(time.getUTCMonth() + 1).padStart(2, '0');
  return `${time.getUTCFullYear()}-${month}-01`;
}

/** The first moment of the UTC month after the one `time` is in. */
export function nextUtcMonthStart(time: Date): Date {
  return new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth() + 1, 1));
}

/**
 * - `give-up`: every attempt was used, the last one stopped in the middle; the article fails.
 * - `wait-for-next-run`: the run is past its synthesis window; the next run synthesizes it.
 * - `defer-to-next-month`: the month's budget is spent.
 * - `synthesize`: start the next attempt.
 */
export type SynthesisStep = 'give-up' | 'wait-for-next-run' | 'defer-to-next-month' | 'synthesize';

export type SynthesisSituation = {
  attempts: number;
  maxAttempts: number;
  /** Whether the run may still start a synthesis. */
  windowOpen: boolean;
  budgetReached: boolean;
};

export function nextSynthesisStep(situation: SynthesisSituation): SynthesisStep {
  if (situation.attempts >= situation.maxAttempts) {
    return 'give-up';
  }
  if (!situation.windowOpen) {
    return 'wait-for-next-run';
  }
  return situation.budgetReached ? 'defer-to-next-month' : 'synthesize';
}

/** Whether a failed attempt was the article's last, so that the article fails. */
export function isLastAttempt(attempt: number, maxAttempts: number): boolean {
  return attempt >= maxAttempts;
}
