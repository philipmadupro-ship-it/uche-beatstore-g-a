/**
 * Checkout discount math — pure, so it can be Vitest-covered in isolation.
 *
 * This is money-critical: a rounding slip here mischarges every buyer. It used
 * to live inline in `/api/store/checkout`, where (per CLAUDE.md) untested route
 * logic gets silently reverted. Extracted here as the `filterAndSortTracks`
 * template prescribes — the route imports these; the test suite is what catches
 * an AI revert wiping the proportional-split or the $0.01 floor.
 *
 * All amounts are in integer cents (Stripe's `unit_amount`). Every line stays
 * ≥ 1 cent so Stripe never rejects a $0.00 line.
 */

export interface PromoTerms {
  code: string;
  discountPercent: number;
  discountAmount: number;
}

export type LineItems = Array<{
  price_data: { currency: string; unit_amount: number; product_data: { name: string } };
  quantity: number;
}>;

export interface BundleRule {
  threshold: number;
  percent: number;
}

/**
 * Automatic bundle/quantity discount. When the cart's item count meets the
 * producer's threshold, knock `percent` off every line uniformly. Runs BEFORE
 * any promo code, so a promo stacks on the already-bundled price. Off when
 * threshold<=0, percent<=0, or the cart is below the threshold. Capped at 90%
 * so a misconfigured rule can't zero out the cart.
 */
export function applyBundleDiscount(
  lineItems: LineItems,
  rule: BundleRule | null,
): { items: LineItems; applied: boolean; percent: number } {
  if (!rule || rule.threshold <= 0 || rule.percent <= 0 || lineItems.length < rule.threshold) {
    return { items: lineItems, applied: false, percent: 0 };
  }
  const factor = 1 - Math.min(90, rule.percent) / 100;
  const items = lineItems.map((li) => ({
    ...li,
    price_data: {
      ...li.price_data,
      unit_amount: Math.max(1, Math.round(li.price_data.unit_amount * factor)),
    },
  }));
  return { items, applied: true, percent: rule.percent };
}

/**
 * Apply a promo code to the line items.
 *   - percent: knock the same % off every line (rounded per-line).
 *   - flat: distribute the cents proportionally across lines, with the
 *     remainder absorbed by the last line so the total discount is exact;
 *     capped at originalTotal-1 so the cart never reaches $0.
 * Returns the discounted lines plus the total cents actually removed.
 */
export function applyDiscount(
  lineItems: LineItems,
  promo: PromoTerms | null,
): { discountedItems: LineItems; discountTotalCents: number } {
  if (!promo || (promo.discountPercent <= 0 && promo.discountAmount <= 0)) {
    return { discountedItems: lineItems, discountTotalCents: 0 };
  }

  const originalTotalCents = lineItems.reduce((sum, li) => sum + li.price_data.unit_amount, 0);

  if (promo.discountPercent > 0) {
    const discountedItems = lineItems.map((li) => ({
      ...li,
      price_data: {
        ...li.price_data,
        unit_amount: Math.max(1, Math.round(li.price_data.unit_amount * (1 - promo.discountPercent / 100))),
      },
    }));
    const newTotal = discountedItems.reduce((sum, li) => sum + li.price_data.unit_amount, 0);
    return { discountedItems, discountTotalCents: originalTotalCents - newTotal };
  }

  // Flat amount discount — distribute proportionally across line items.
  const discountCents = Math.min(Math.round(promo.discountAmount * 100), originalTotalCents - 1);
  let remaining = discountCents;
  const discountedItems = lineItems.map((li, idx) => {
    if (remaining <= 0) return li;
    const share = Math.round((li.price_data.unit_amount / originalTotalCents) * discountCents);
    const actualDiscount = idx === lineItems.length - 1 ? remaining : Math.min(share, remaining);
    remaining -= actualDiscount;
    return {
      ...li,
      price_data: {
        ...li.price_data,
        unit_amount: Math.max(1, li.price_data.unit_amount - actualDiscount),
      },
    };
  });

  return { discountedItems, discountTotalCents: discountCents };
}
