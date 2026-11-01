/**
 * Money for Label OS finance (LABEL-61). Pure; no floats anywhere.
 *
 * An amount is an INTEGER number of minor units (cents, pence, yen…) in one
 * ISO-4217 currency, held as a `bigint` so arithmetic can never lose a unit to
 * a double. The database stores the same thing as `bigint` + `char(3)`; it
 * never stores `numeric`/`float` for money.
 *
 * Rules (each is tested, including by a seeded property run):
 *  - add / sub / compare REFUSE mixed currencies (`CurrencyMismatchError`);
 *    there is no implicit conversion and none will be added here.
 *  - The minor-unit exponent comes from `CURRENCY_EXPONENT` (JPY 0, USD 2,
 *    KWD 3…). A currency not in the table is refused rather than guessed at.
 *  - ROUNDING RULE: wherever an exact result is not a whole number of minor
 *    units (applying a rate or a share), round HALF TO EVEN ("banker's
 *    rounding"). Chosen over half-away-from-zero because it is unbiased: over
 *    many statement lines the rounding error averages to zero instead of
 *    drifting towards whoever is paid. It is symmetric in sign
 *    (round(-x) = -round(x)).
 *  - ALLOCATION splits an amount by integer weights with the LARGEST-REMAINDER
 *    method: every part gets floor(total × weight / Σweights), then the
 *    leftover units go one each to the largest fractional remainders. The parts
 *    ALWAYS sum exactly to the total. TIE-BREAK: equal remainders go to the
 *    lower index first (input order), so the result is deterministic and
 *    independent of the runtime. Negative totals are allocated as the mirror of
 *    the positive one. Weights may be the split-sheet share units
 *    (100 % = 1 000 000, `lib/labelos/splits.ts`), but any non-negative
 *    integers work.
 */

import { FULL_SHARE } from '@/lib/labelos/splits';

/** Minor-unit exponent by ISO-4217 code: 10^exponent minor units per major unit. */
export const CURRENCY_EXPONENT: Readonly<Record<string, 0 | 2 | 3>> = {
  // 0 decimals
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // 3 decimals
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  // 2 decimals
  AED: 2, ARS: 2, AUD: 2, BRL: 2, CAD: 2, CHF: 2, CNY: 2, COP: 2, CZK: 2, DKK: 2, EGP: 2, EUR: 2, GBP: 2, GHS: 2, HKD: 2,
  HUF: 2, IDR: 2, ILS: 2, INR: 2, KES: 2, MAD: 2, MXN: 2, MYR: 2, NGN: 2, NOK: 2, NZD: 2, PEN: 2, PHP: 2, PKR: 2, PLN: 2,
  RON: 2, RUB: 2, SAR: 2, SEK: 2, SGD: 2, THB: 2, TRY: 2, TWD: 2, TZS: 2, UAH: 2, USD: 2, ZAR: 2,
};

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot combine ${a} with ${b}: amounts in different currencies are never mixed.`);
    this.name = 'CurrencyMismatchError';
  }
}

export interface Money {
  /** Integer minor units. Negative is a deduction or a reversal. */
  readonly minor: bigint;
  /** ISO-4217 upper-case code, in `CURRENCY_EXPONENT`. */
  readonly currency: string;
}

export const isCurrency = (v: unknown): v is string => typeof v === 'string' && Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENT, v);

export function currencyExponent(currency: string): number {
  if (!isCurrency(currency)) throw new RangeError(`Unknown currency "${currency}"`);
  return CURRENCY_EXPONENT[currency];
}

export function money(minor: bigint | number, currency: string): Money {
  if (!isCurrency(currency)) throw new RangeError(`Unknown currency "${currency}"`);
  if (typeof minor === 'number') {
    if (!Number.isSafeInteger(minor)) throw new RangeError('Money must be a whole number of minor units');
    return { minor: BigInt(minor), currency };
  }
  return { minor, currency };
}

function same(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export const add = (a: Money, b: Money): Money => (same(a, b), { minor: a.minor + b.minor, currency: a.currency });
export const sub = (a: Money, b: Money): Money => (same(a, b), { minor: a.minor - b.minor, currency: a.currency });
export const negate = (a: Money): Money => ({ minor: -a.minor, currency: a.currency });
export const isZero = (a: Money): boolean => a.minor === BigInt(0);

/** -1 | 0 | 1. Refuses mixed currencies. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  same(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

/** Sum of amounts; an empty list needs the currency to say what zero it is. */
export function sum(items: readonly Money[], currency: string): Money {
  let total = money(BigInt(0), currency);
  for (const m of items) total = add(total, m);
  return total;
}

const abs = (n: bigint): bigint => (n < BigInt(0) ? -n : n);

/**
 * round-half-to-even of numerator / denominator (denominator > 0), exact in
 * integers. Symmetric in the sign of the numerator.
 */
export function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) throw new RangeError('The denominator must be positive');
  const neg = numerator < BigInt(0);
  const n = abs(numerator);
  let q = n / denominator;
  const r2 = (n % denominator) * BigInt(2);
  if (r2 > denominator || (r2 === denominator && q % BigInt(2) === BigInt(1))) q += BigInt(1);
  return neg ? -q : q;
}

/** amount × (num / den), rounded half to even. A rate, expressed as a ratio of integers. */
export function mulRatio(amount: Money, num: bigint | number, den: bigint | number): Money {
  const n = BigInt(num);
  const d = BigInt(den);
  return { minor: divRoundHalfEven(amount.minor * n, d), currency: amount.currency };
}

/** amount × a split share (100 % = 1 000 000 units, `lib/labelos/splits.ts`), rounded half to even. */
export const applyShare = (amount: Money, shareUnits: number): Money => {
  if (!Number.isInteger(shareUnits) || shareUnits < 0) throw new RangeError('A share is a non-negative whole number of units');
  return mulRatio(amount, shareUnits, FULL_SHARE);
};

/**
 * Largest-remainder allocation (see the file header). Returns one Money per
 * weight, in order; the parts sum to `total` exactly. A zero weight gets zero.
 */
export function allocate(total: Money, weights: readonly (number | bigint)[]): Money[] {
  if (weights.length === 0) throw new RangeError('Nothing to allocate to');
  const w = weights.map((x) => {
    const b = typeof x === 'bigint' ? x : Number.isSafeInteger(x) ? BigInt(x) : null;
    if (b === null || b < BigInt(0)) throw new RangeError('Weights are non-negative whole numbers');
    return b;
  });
  const weightSum = w.reduce((s, x) => s + x, BigInt(0));
  if (weightSum === BigInt(0)) throw new RangeError('The weights sum to zero: there is no one to allocate to');

  const neg = total.minor < BigInt(0);
  const t = abs(total.minor);
  const floors = w.map((x) => (t * x) / weightSum);
  const remainders = w.map((x) => (t * x) % weightSum);
  let left = t - floors.reduce((s, x) => s + x, BigInt(0));

  // Largest remainder first; equal remainders → lower index first.
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const parts = floors.slice();
  for (const { i } of order) {
    if (left === BigInt(0)) break;
    // A zero weight has remainder 0: it can only be reached after every positive remainder, and `left` < number of positive remainders.
    if (w[i] === BigInt(0)) continue;
    parts[i] += BigInt(1);
    left -= BigInt(1);
  }
  return parts.map((p) => ({ minor: neg ? -p : p, currency: total.currency }));
}

// ── The database and the screen ───────────────────────────────────────────

/**
 * A `bigint` column read through PostgREST arrives as a JSON number (or a
 * string for big values). Accept both; refuse anything that is not an exact
 * integer, so a lossy double is never turned into money.
 */
export function minorFromDb(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('Amount is not an exact integer');
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d{1,18}$/.test(value)) return BigInt(value);
  throw new RangeError('Amount is not an integer');
}

/** The JSON-safe form of an amount: a string, so no consumer ever rounds it through a double. */
export const minorToJson = (m: Money): string => m.minor.toString();

/**
 * Parse text typed in major units ("12.34", "1,234.5", "-3") into minor
 * units, digit by digit (no float). More decimals than the currency has is
 * refused, not rounded: a person typing 0.005 USD meant something we cannot
 * guess. Returns null when it is not a valid amount.
 */
export function parseMajor(input: string, currency: string): Money | null {
  if (!isCurrency(currency)) return null;
  const exp = CURRENCY_EXPONENT[currency];
  const m = /^\s*(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*$/.exec(input);
  if (!m) return null;
  const frac = m[3] ?? '';
  if (frac.length > exp) return null;
  const whole = m[2].replace(/,/g, '');
  if (whole.length > 15) return null;
  const minor = BigInt(whole + frac.padEnd(exp, '0'));
  return { minor: m[1] ? -minor : minor, currency };
}

/** "1234.50" — plain, no grouping, no symbol; the screen's formatter adds those. */
export function formatMajor(m: Money): string {
  const exp = currencyExponent(m.currency);
  const neg = m.minor < BigInt(0);
  const digits = abs(m.minor).toString().padStart(exp + 1, '0');
  const body = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  return neg ? `-${body}` : body;
}
