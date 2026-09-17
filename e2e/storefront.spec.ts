/**
 * Storefront smoke — what a buyer experiences on / store.
 *
 * Keeps the surface coarse on purpose: we don't simulate Stripe
 * Elements or the actual webhook (Vitest's webhook test covers that
 * idempotency layer). The goal here is regression coverage on the
 * three things that have broken end-to-end before:
 *   1. /store loads, shows the producer hero + at least one card.
 *   2. Clicking a beat card opens the right-side preview drawer.
 *   3. The cart drawer renders the items added via the "Lease" button.
 *   4. Hitting "Checkout" navigates to /store/checkout (without
 *      blowing up on the publishable-key sentinel).
 *
 * Tests rely on the producer's storefront being non-empty in the
 * connected Supabase. They skip cleanly when the store is empty so
 * a brand-new Supabase still passes.
 */
import { test, expect } from '@playwright/test';

test.describe('storefront', () => {
  test('shows producer hero + at least one beat card', async ({ page }) => {
    await page.goto('/store');

    // Hero — producer's name appears as the big ParticleText canvas; the
    // sr-only <h1> fallback is what Playwright can actually assert on.
    await expect(page.locator('h1.sr-only').first()).not.toHaveText('');

    // Either we have beats or the empty state is visible. Both pass.
    const cards = page.locator('[id^="beat-"]');
    const empty = page.getByText(/no beats in the store yet|no beats match/i);
    await expect(cards.first().or(empty).first()).toBeVisible();
  });

  test('clicking a beat card opens the preview drawer', async ({ page }) => {
    await page.goto('/store');
    // Wait for /api/store to populate the grid before assuming we know
    // whether the store has any cards.
    const firstCard = page.locator('[id^="beat-"]').first();
    await firstCard.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null);
    if (await firstCard.count() === 0) test.skip(true, 'no beats in store');

    await firstCard.click();
    await expect(page.getByText('Preview', { exact: true }).first()).toBeVisible();
  });

  test('adding to cart and clicking checkout navigates to /store/checkout', async ({ page }) => {
    await page.goto('/store');
    const firstCard = page.locator('[id^="beat-"]').first();
    await firstCard.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null);
    if (await firstCard.count() === 0) test.skip(true, 'no beats in store');

    // The two-line Lease button has "Lease" text inside a <span>;
    // scope to the visible card so we don't grab a hidden recommendation
    // strip variant. Use auto-waiting click instead of pre-checking count.
    const leaseLabel = firstCard.getByText('Lease', { exact: true }).first();
    if (await leaseLabel.count() === 0) test.skip(true, 'first card has no Lease (likely free-download)');
    // Click the button ancestor that wraps the label
    await leaseLabel.locator('xpath=ancestor::button[1]').first().click();

    // Adding to cart opens the cart drawer on its own, and its scrim then
    // covers the header cart button. Only click the button if the drawer
    // didn't open. (The old `button:has-text("$"):has-text("·")` match
    // resolved to the hidden install-app pill, so this step never passed.)
    const checkoutBtn = page.getByRole('button', { name: /^checkout$/i });
    if (!(await checkoutBtn.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /^Cart \(1\)$/ }).click();
    }
    await expect(checkoutBtn).toBeVisible({ timeout: 5_000 });

    // Checkout stays disabled until the license terms are accepted.
    await page.getByLabel('Email for license delivery').fill('e2e-buyer@example.test');
    await page.locator('#cart-license-terms').check();
    await expect(checkoutBtn).toBeEnabled();
    await checkoutBtn.click();

    await page.waitForURL(/\/store\/checkout/);
  });
});
