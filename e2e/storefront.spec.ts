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
 * STRICTNESS DEPENDS ON WHETHER THE STORE IS SEEDED.
 *
 * These skip cleanly on an empty store so a brand-new Supabase still passes —
 * but that leniency used to apply in CI too, where the store is NOT unknown:
 * the workflow copies `e2e/fixtures/store-db.json` over `data/db.json` and runs
 * with ENABLE_LOCAL_STORE=true, so two listed beats are guaranteed. The first
 * test accepted `cards.or(empty)` and the other two called `test.skip()` when
 * no card appeared, which meant a regression that emptied the catalogue —
 * a broken query, a bad filter default, a crashed render — reported
 * "2 passed, 4 skipped" and went green. The suite could not fail for the one
 * reason it exists.
 *
 * So: when the fixture is in play, the storefront MUST render it. `test.skip`
 * is reserved for the genuinely-unknown case of a dev pointing this at their
 * own empty Supabase.
 */
import { test, expect } from '@playwright/test';

/**
 * True when this run is against the committed fixture, which is the case in
 * CI. Set by the same env var the server reads, so the two cannot disagree
 * about which data is loaded.
 */
const SEEDED = process.env.ENABLE_LOCAL_STORE === 'true';

/** What `e2e/fixtures/store-db.json` guarantees when SEEDED. */
const FIXTURE = { producer: 'E2E Producer', listedBeats: 2 };

/**
 * Bail out of a test whose precondition is missing.
 *
 * On an unknown store that is a legitimate skip. On a seeded run it throws,
 * because the fixture guarantees the precondition and its absence is the
 * regression this suite exists to catch. Note this is only ever reached when
 * something IS missing — a seeded run with a healthy catalogue never calls it,
 * and a non-seeded run with beats present carries on normally.
 */
function missingPrecondition(reason: string): never {
  if (SEEDED) {
    throw new Error(
      `${reason} — but this run is seeded from e2e/fixtures/store-db.json, ` +
      `which has ${FIXTURE.listedBeats} listed beats. Skipping here would hide a real regression.`,
    );
  }
  test.skip(true, reason);
  throw new Error('unreachable');
}

test.describe('storefront', () => {
  test('shows producer hero + at least one beat card', async ({ page }) => {
    await page.goto('/store');

    // Hero — producer's name appears as the big ParticleText canvas; the
    // sr-only <h1> fallback is what Playwright can actually assert on.
    const hero = page.locator('h1.sr-only').first();
    await expect(hero).not.toHaveText('');

    const cards = page.locator('[id^="beat-"]');
    const empty = page.getByText(/no beats in the store yet|no beats match/i);

    if (SEEDED) {
      // The fixture is loaded, so the catalogue is a known quantity. Assert it
      // rather than accepting whatever rendered — this is the assertion that
      // makes a catalogue regression fail the build.
      await expect(hero).toHaveText(new RegExp(FIXTURE.producer, 'i'));
      await expect(cards).toHaveCount(FIXTURE.listedBeats);
      await expect(empty).toHaveCount(0);
      return;
    }

    // Unknown store: either we have beats or the empty state is visible.
    await expect(cards.first().or(empty).first()).toBeVisible();
  });

  test('clicking a beat card opens the preview drawer', async ({ page }) => {
    await page.goto('/store');
    // Wait for /api/store to populate the grid before assuming we know
    // whether the store has any cards.
    const firstCard = page.locator('[id^="beat-"]').first();
    await firstCard.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null);
    if (await firstCard.count() === 0) missingPrecondition('no beats in store');

    await firstCard.click();
    await expect(page.getByText('Preview', { exact: true }).first()).toBeVisible();
  });

  test('adding to cart and clicking checkout navigates to /store/checkout', async ({ page }) => {
    await page.goto('/store');
    const firstCard = page.locator('[id^="beat-"]').first();
    await firstCard.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null);
    if (await firstCard.count() === 0) missingPrecondition('no beats in store');

    // The two-line Lease button has "Lease" text inside a <span>;
    // scope to the visible card so we don't grab a hidden recommendation
    // strip variant. Use auto-waiting click instead of pre-checking count.
    const leaseLabel = firstCard.getByText('Lease', { exact: true }).first();
    // Both fixture beats carry a $30 lease, so on a seeded run a missing Lease
    // button is a broken price/licence render, not an unpriced catalogue.
    if (await leaseLabel.count() === 0) missingPrecondition('first card has no Lease (likely free-download)');
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
