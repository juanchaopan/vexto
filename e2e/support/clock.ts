import type { Page } from '@playwright/test';

/** Moment the page clock shows during screenshot tests, so dates render the same on every run. */
export const FIXED_TIME = new Date('2026-01-15T09:30:00Z');

/**
 * Makes `Date.now()` and `new Date()` in the page always return `time`; timers keep running.
 * Call it before `page.goto()` so the page never sees the real time.
 */
export async function freezeClock(page: Page, time: Date = FIXED_TIME): Promise<void> {
  await page.clock.setFixedTime(time);
}
