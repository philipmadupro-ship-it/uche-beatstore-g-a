import { describe, it, expect } from 'vitest';
import { applyDiscount, applyBundleDiscount, type LineItems, type PromoTerms } from './discount';

/** Build line items from a list of unit_amount cents. */
function lines(...cents: number[]): LineItems {
  return cents.map((unit_amount, i) => ({
    price_data: { currency: 'usd', unit_amount, product_data: { name: `Item ${i}` } },
    quantity: 1,
  }));
}
const amounts = (li: LineItems) => li.map((l) => l.price_data.unit_amount);
const total = (li: LineItems) => amounts(li).reduce((a, b) => a + b, 0);

const percent = (p: number): PromoTerms => ({ code: 'P', discountPercent: p, discountAmount: 0 });
const flat = (dollars: number): PromoTerms => ({ code: 'F', discountPercent: 0, discountAmount: dollars });

describe('applyDiscount — no-op cases', () => {
  it('returns items unchanged for a null promo', () => {
    const li = lines(1000, 500);
    const out = applyDiscount(li, null);
    expect(out.discountedItems).toEqual(li);
    expect(out.discountTotalCents).toBe(0);
  });

  it('returns items unchanged for a zero promo', () => {
    const out = applyDiscount(lines(1000), { code: 'Z', discountPercent: 0, discountAmount: 0 });
    expect(out.discountTotalCents).toBe(0);
  });
});

describe('applyDiscount — percent', () => {
  it('knocks the percent off every line and reports the exact total removed', () => {
    const out = applyDiscount(lines(1000, 500), percent(10));
    expect(amounts(out.discountedItems)).toEqual([900, 450]);
    expect(out.discountTotalCents).toBe(150);
  });

  it('rounds per line', () => {
    const out = applyDiscount(lines(1000), percent(33));
    expect(amounts(out.discountedItems)).toEqual([670]); // round(1000*0.67)
    expect(out.discountTotalCents).toBe(330);
  });

  it('never lets a line fall below 1 cent even at 100% off', () => {
    const out = applyDiscount(lines(1000), percent(100));
    expect(amounts(out.discountedItems)).toEqual([1]);
  });
});

describe('applyDiscount — flat (proportional split)', () => {
  it('distributes a flat discount proportionally and exactly', () => {
    const out = applyDiscount(lines(600, 400), flat(5)); // $5 = 500c over 1000c
    expect(amounts(out.discountedItems)).toEqual([300, 200]);
    expect(out.discountTotalCents).toBe(500);
    expect(total(out.discountedItems)).toBe(500); // original 1000 - 500
  });

  it('absorbs the rounding remainder on the last line so the total is exact', () => {
    const out = applyDiscount(lines(333, 333, 334), flat(1)); // $1 = 100c
    expect(out.discountTotalCents).toBe(100);
    expect(total(out.discountedItems)).toBe(900); // exactly 100c removed
    // last line takes the remainder
    expect(amounts(out.discountedItems)).toEqual([300, 300, 300]);
  });

  it('caps the discount at originalTotal-1 so the cart never reaches $0', () => {
    const out = applyDiscount(lines(500), flat(10)); // $10 > $5 cart
    expect(out.discountTotalCents).toBe(499);
    expect(amounts(out.discountedItems)).toEqual([1]);
    expect(total(out.discountedItems)).toBeGreaterThanOrEqual(1);
  });
});

describe('applyBundleDiscount', () => {
  it('does nothing for a null rule', () => {
    const li = lines(1000, 1000);
    expect(applyBundleDiscount(li, null)).toEqual({ items: li, applied: false, percent: 0 });
  });

  it('does nothing below the threshold', () => {
    const out = applyBundleDiscount(lines(1000, 1000), { threshold: 3, percent: 20 });
    expect(out.applied).toBe(false);
    expect(amounts(out.items)).toEqual([1000, 1000]);
  });

  it('applies uniformly once the threshold is met', () => {
    const out = applyBundleDiscount(lines(1000, 1000, 1000), { threshold: 3, percent: 20 });
    expect(out.applied).toBe(true);
    expect(out.percent).toBe(20);
    expect(amounts(out.items)).toEqual([800, 800, 800]);
  });

  it('caps the bundle percent at 90 so a misconfigured rule cannot zero the cart', () => {
    const out = applyBundleDiscount(lines(1000), { threshold: 1, percent: 95 });
    expect(amounts(out.items)).toEqual([100]); // factor 0.1, not 0.05
  });

  it('ignores non-positive thresholds/percents', () => {
    expect(applyBundleDiscount(lines(1000), { threshold: 0, percent: 20 }).applied).toBe(false);
    expect(applyBundleDiscount(lines(1000), { threshold: 1, percent: 0 }).applied).toBe(false);
  });
});

describe('bundle + promo stack (the real checkout order)', () => {
  it('applies the bundle first, then the promo on the reduced price', () => {
    const bundle = applyBundleDiscount(lines(1000, 1000, 1000), { threshold: 3, percent: 20 });
    expect(amounts(bundle.items)).toEqual([800, 800, 800]);
    const final = applyDiscount(bundle.items, percent(10));
    expect(amounts(final.discountedItems)).toEqual([720, 720, 720]);
  });
});
