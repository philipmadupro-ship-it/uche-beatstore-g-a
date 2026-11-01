import { describe, expect, it } from 'vitest';
import { FULL_SHARE } from '@/lib/labelos/splits';
import {
  CurrencyMismatchError,
  add,
  allocate,
  applyShare,
  compare,
  currencyExponent,
  divRoundHalfEven,
  formatMajor,
  isCurrency,
  minorFromDb,
  money,
  mulRatio,
  negate,
  parseMajor,
  sub,
  sum,
} from './money';

/** mulberry32: a seeded generator, so a failing case reproduces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

describe('currencies', () => {
  it('knows the minor-unit exponents', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
  });
  it('refuses an unknown currency', () => {
    expect(isCurrency('XXX')).toBe(false);
    expect(() => money(1, 'XXX')).toThrow(RangeError);
    expect(() => money(1, 'usd')).toThrow(RangeError);
    expect(isCurrency('toString')).toBe(false);
  });
  it('refuses a non-integer amount', () => {
    expect(() => money(1.5, 'USD')).toThrow(RangeError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, 'USD')).toThrow(RangeError);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and compares in one currency', () => {
    const a = money(1050, 'USD');
    const b = money(250, 'USD');
    expect(add(a, b).minor).toBe(1300n);
    expect(sub(b, a).minor).toBe(-800n);
    expect(compare(a, b)).toBe(1);
    expect(compare(b, a)).toBe(-1);
    expect(compare(a, a)).toBe(0);
    expect(negate(a).minor).toBe(-1050n);
  });
  it('refuses mixed currencies everywhere', () => {
    const usd = money(100, 'USD');
    const eur = money(100, 'EUR');
    expect(() => add(usd, eur)).toThrow(CurrencyMismatchError);
    expect(() => sub(usd, eur)).toThrow(CurrencyMismatchError);
    expect(() => compare(usd, eur)).toThrow(CurrencyMismatchError);
    expect(() => sum([usd, eur], 'USD')).toThrow(CurrencyMismatchError);
  });
  it('sums an empty list to a zero of the stated currency', () => {
    expect(sum([], 'JPY')).toEqual({ minor: 0n, currency: 'JPY' });
  });
  it('does not lose units where a double would', () => {
    const big = money(9_007_199_254_740_993n, 'USD');
    expect(add(big, money(1, 'USD')).minor).toBe(9_007_199_254_740_994n);
  });
});

describe('rounding: half to even', () => {
  it.each([
    [5n, 2n, 2n], // 2.5 → 2
    [7n, 2n, 4n], // 3.5 → 4
    [3n, 2n, 2n], // 1.5 → 2
    [1n, 2n, 0n], // 0.5 → 0
    [-5n, 2n, -2n],
    [-7n, 2n, -4n],
    [-1n, 2n, 0n],
    [10n, 3n, 3n],
    [11n, 3n, 4n],
    [-11n, 3n, -4n],
    [0n, 7n, 0n],
  ])('%s / %s = %s', (n, d, expected) => {
    expect(divRoundHalfEven(n, d)).toBe(expected);
  });
  it('is symmetric in sign for random cases', () => {
    const r = rng(11);
    for (let i = 0; i < 2000; i++) {
      const n = BigInt(int(r, 0, 1_000_000_000));
      const d = BigInt(int(r, 1, 1_000_000));
      expect(divRoundHalfEven(-n, d)).toBe(-divRoundHalfEven(n, d));
    }
  });
  it('is within half a unit of the exact quotient', () => {
    const r = rng(12);
    for (let i = 0; i < 2000; i++) {
      const n = BigInt(int(r, 0, 1_000_000_000));
      const d = BigInt(int(r, 1, 1_000_000));
      const q = divRoundHalfEven(n, d);
      // |q·d − n| ≤ d/2  ⇔  2|q·d − n| ≤ d
      const diff = q * d - n;
      expect((diff < 0n ? -diff : diff) * 2n <= d).toBe(true);
    }
  });
  it('applies a rate and a share', () => {
    expect(mulRatio(money(1005, 'USD'), 1, 2).minor).toBe(502n); // 502.5 → 502
    expect(mulRatio(money(1007, 'USD'), 1, 2).minor).toBe(504n); // 503.5 → 504
    expect(applyShare(money(10_000, 'USD'), FULL_SHARE / 2).minor).toBe(5_000n);
    expect(applyShare(money(1, 'USD'), FULL_SHARE / 2).minor).toBe(0n); // 0.5 → 0
    expect(applyShare(money(3, 'USD'), FULL_SHARE / 2).minor).toBe(2n); // 1.5 → 2
    expect(() => applyShare(money(1, 'USD'), -1)).toThrow(RangeError);
    expect(() => applyShare(money(1, 'USD'), 0.5)).toThrow(RangeError);
  });
});

describe('largest-remainder allocation', () => {
  const parts = (total: number, weights: number[], cur = 'USD') => allocate(money(total, cur), weights).map((m) => Number(m.minor));

  it('splits evenly when it can', () => {
    expect(parts(100, [1, 1])).toEqual([50, 50]);
  });
  it('gives the extra unit to the largest remainder', () => {
    expect(parts(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(parts(10, [3, 3, 4])).toEqual([3, 3, 4]);
    expect(parts(5, [50, 30, 20])).toEqual([3, 1, 1]); // 2.5 / 1.5 / 1.0 → floors 2,1,1; one left → remainder 0.5 vs 0.5: lower index
  });
  it('breaks ties by input order', () => {
    expect(parts(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(parts(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });
  it('allocates a negative amount as the mirror of the positive one', () => {
    expect(parts(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });
  it('allocates a split sheet exactly', () => {
    const w = [333_333, 333_333, 333_334];
    const out = allocate(money(1_000_001, 'USD'), w);
    expect(out.reduce((s, m) => s + m.minor, 0n)).toBe(1_000_001n);
  });
  it('gives a zero weight nothing and refuses nonsense', () => {
    expect(parts(7, [0, 1, 0])).toEqual([0, 7, 0]);
    expect(() => allocate(money(7, 'USD'), [0, 0])).toThrow(RangeError);
    expect(() => allocate(money(7, 'USD'), [])).toThrow(RangeError);
    expect(() => allocate(money(7, 'USD'), [1, -1])).toThrow(RangeError);
    expect(() => allocate(money(7, 'USD'), [1.5])).toThrow(RangeError);
  });
  it('keeps the currency', () => {
    expect(allocate(money(5, 'JPY'), [1, 1]).every((m) => m.currency === 'JPY')).toBe(true);
  });

  it('property: parts always sum exactly to the total, are never off by more than one unit from the exact share, and are deterministic', () => {
    const r = rng(2026);
    for (let i = 0; i < 3000; i++) {
      const n = int(r, 1, 12);
      const weights = Array.from({ length: n }, () => (r() < 0.15 ? 0 : int(r, 0, FULL_SHARE)));
      if (weights.every((x) => x === 0)) weights[int(r, 0, n - 1)] = int(r, 1, FULL_SHARE);
      const totalMinor = int(r, -2_000_000_000, 2_000_000_000);
      const total = money(totalMinor, 'USD');
      const out = allocate(total, weights);

      expect(out).toHaveLength(n);
      expect(out.reduce((s, m) => s + m.minor, 0n)).toBe(total.minor);
      expect(allocate(total, weights)).toEqual(out); // deterministic
      const wsum = weights.reduce((s, x) => s + x, 0);
      weights.forEach((w, k) => {
        if (w === 0) expect(out[k].minor).toBe(0n);
        // |part − total·w/Σ| < 1 unit, checked exactly: |part·Σ − total·w| < Σ
        const diff = out[k].minor * BigInt(wsum) - total.minor * BigInt(w);
        expect((diff < 0n ? -diff : diff) < BigInt(wsum)).toBe(true);
        // never of the opposite sign to the total
        if (totalMinor >= 0) expect(out[k].minor >= 0n).toBe(true);
        else expect(out[k].minor <= 0n).toBe(true);
      });
      // mirror property
      expect(allocate(negate(total), weights).map((m) => m.minor)).toEqual(out.map((m) => -m.minor));
    }
  });

  it('property: equal weights differ by at most one unit', () => {
    const r = rng(7);
    for (let i = 0; i < 1000; i++) {
      const n = int(r, 1, 20);
      const out = allocate(money(int(r, 0, 1_000_000), 'EUR'), Array(n).fill(1));
      const min = out.reduce((a, m) => (m.minor < a ? m.minor : a), out[0].minor);
      const max = out.reduce((a, m) => (m.minor > a ? m.minor : a), out[0].minor);
      expect(max - min <= 1n).toBe(true);
    }
  });
});

describe('database and screen forms', () => {
  it('reads bigint columns exactly', () => {
    expect(minorFromDb(12)).toBe(12n);
    expect(minorFromDb('-9007199254740993')).toBe(-9_007_199_254_740_993n);
    expect(() => minorFromDb(1.5)).toThrow(RangeError);
    expect(() => minorFromDb(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => minorFromDb(null)).toThrow(RangeError);
    expect(() => minorFromDb('1e3')).toThrow(RangeError);
  });
  it('parses typed amounts without floats', () => {
    expect(parseMajor('12.34', 'USD')?.minor).toBe(1234n);
    expect(parseMajor('1,234.5', 'USD')?.minor).toBe(123450n);
    expect(parseMajor('-3', 'USD')?.minor).toBe(-300n);
    expect(parseMajor('500', 'JPY')?.minor).toBe(500n);
    expect(parseMajor('1.234', 'KWD')?.minor).toBe(1234n);
    expect(parseMajor('0.1', 'USD')?.minor).toBe(10n);
  });
  it('refuses more precision than the currency has, and junk', () => {
    expect(parseMajor('0.005', 'USD')).toBeNull();
    expect(parseMajor('1.5', 'JPY')).toBeNull();
    expect(parseMajor('1e3', 'USD')).toBeNull();
    expect(parseMajor('', 'USD')).toBeNull();
    expect(parseMajor('12,34', 'USD')).toBeNull();
    expect(parseMajor('1', 'XXX')).toBeNull();
  });
  it('formats and round-trips', () => {
    expect(formatMajor(money(1234, 'USD'))).toBe('12.34');
    expect(formatMajor(money(5, 'USD'))).toBe('0.05');
    expect(formatMajor(money(-5, 'USD'))).toBe('-0.05');
    expect(formatMajor(money(500, 'JPY'))).toBe('500');
    expect(formatMajor(money(1, 'KWD'))).toBe('0.001');
    const r = rng(5);
    for (const cur of ['USD', 'JPY', 'KWD']) {
      for (let i = 0; i < 300; i++) {
        const m = money(int(r, -1_000_000_000, 1_000_000_000), cur);
        expect(parseMajor(formatMajor(m), cur)).toEqual(m);
      }
    }
  });
});
