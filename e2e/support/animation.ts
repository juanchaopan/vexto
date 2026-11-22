import type { Page } from '@playwright/test';

/**
 * Pauses the running CSS and Web Animations of the elements matching `selector` (and their
 * descendants; every element when no selector is given) at `atMs` milliseconds into each animation.
 *
 * The screenshot default `animations: 'disabled'` would jump finite animations to their end, so
 * take the screenshot of a held animation with `toHaveScreenshot({ animations: 'allow' })`.
 */
export async function holdAnimationsAt(page: Page, atMs: number, selector?: string): Promise<void> {
  const held = await page.evaluate(
    ({ moment, scope }) => {
      const animations = document.getAnimations().filter((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return !scope || (target !== null && target.closest(scope) !== null);
      });
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = moment;
      }
      return animations.length;
    },
    { moment: atMs, scope: selector },
  );
  if (held === 0) {
    throw new Error(`No running animation matches ${selector ?? 'the page'}`);
  }
}
