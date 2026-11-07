import { expect, type Locator } from '@playwright/test';

/**
 * Click a control only once React has hydrated it.
 *
 * A server-rendered button is visible, enabled and "stable" long before its
 * handler exists, so Playwright's own actionability checks pass and the click
 * lands on inert HTML: nothing happens, no error, and the next assertion then
 * waits out its whole timeout. React 19 attaches `__reactProps$…` to a host
 * node when it hydrates it, which is the one signal that the handler is there.
 */
export async function clickWhenHydrated(target: Locator): Promise<void> {
  await expect
    .poll(() => target.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps$'))), { message: 'the control was never hydrated' })
    .toBe(true);
  await target.click();
}
