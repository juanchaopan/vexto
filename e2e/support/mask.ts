import type { Locator, Page } from '@playwright/test';

/** Attribute that marks page areas whose content changes between runs, such as generated text. */
export const VOLATILE_ATTRIBUTE = 'data-volatile';

/**
 * Areas to cover in a screenshot: every element marked volatile, plus any extra locators.
 * Pass the result as the `mask` option of `toHaveScreenshot()`.
 */
export function volatileAreas(page: Page, ...extra: Locator[]): Locator[] {
  return [page.locator(`[${VOLATILE_ATTRIBUTE}]`), ...extra];
}
