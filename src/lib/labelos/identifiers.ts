/**
 * Music industry identifiers (05 §7, LABEL-16): format checks and one
 * normalised form per code, so the same code typed two ways is stored once.
 * Pure; the routes validate through these before anything is written, and
 * the database CHECKs (140 `tracks_iswc_format`, 141 `tracks_isrc_format`,
 * 144 `releases_upc_format`) accept every normalised value
 * (identifiers.test.ts holds that).
 *
 *  - ISRC (a recording): CC-XXX-YY-NNNNN — country (2 letters), registrant
 *    (3 alphanumerics), year (2 digits), designation (5 digits). Stored
 *    compact and upper case. No check digit exists.
 *  - UPC / EAN (a release): 12-digit UPC-A or 13-digit EAN-13, with the GS1
 *    mod-10 check digit verified — a transposed digit is the usual typo, and
 *    a code that fails it is never a real barcode. Stored digits only.
 *  - ISWC (a musical work): T + 9 digits + check digit. Stored in its
 *    display form T-DDD.DDD.DDD-C.
 *  - IPI (a rights holder's name number): 9 to 11 digits, stored digits
 *    only. The 05 format only — CAE-era 9-digit numbers are still in use,
 *    so no padding and no check digit.
 */

export const IDENTIFIER_KINDS = ['isrc', 'upc', 'iswc', 'ipi'] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

/** The normalised forms. `upc` is the 144 CHECK verbatim. */
export const IDENTIFIER_PATTERNS: Record<IdentifierKind, RegExp> = {
  isrc: /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/,
  upc: /^[0-9]{12,13}$/,
  iswc: /^T-[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]$/,
  ipi: /^[0-9]{9,11}$/,
};

const DESCRIPTIONS: Record<IdentifierKind, string> = {
  isrc: 'not a valid ISRC (CC-XXX-YY-NNNNN)',
  upc: 'not a valid UPC/EAN (12 or 13 digits with a valid check digit)',
  iswc: 'not a valid ISWC (T-DDD.DDD.DDD-C with a valid check digit)',
  ipi: 'not a valid IPI (9 to 11 digits)',
};

/** Spaces, dashes and dots are how people group these codes; none is part of one. */
const stripSeparators = (raw: string) => raw.replace(/[\s.\-]/g, '');

export function normalizeIsrc(raw: string): string | null {
  const v = stripSeparators(raw).toUpperCase();
  return IDENTIFIER_PATTERNS.isrc.test(v) ? v : null;
}

/** GS1 check digit of a code body (the code without its last digit): weights 3,1,3,… from the right. */
export function upcCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function normalizeUpc(raw: string): string | null {
  const v = stripSeparators(raw);
  if (!IDENTIFIER_PATTERNS.upc.test(v)) return null;
  return upcCheckDigit(v.slice(0, -1)) === Number(v[v.length - 1]) ? v : null;
}

/** ISWC check digit of its 9 work digits: (1 + Σ i·dᵢ) mod 10, complemented. */
export function iswcCheckDigit(digits: string): number {
  let sum = 1;
  for (let i = 0; i < digits.length; i++) sum += (i + 1) * Number(digits[i]);
  return (10 - (sum % 10)) % 10;
}

export function normalizeIswc(raw: string): string | null {
  const m = /^T([0-9]{9})([0-9])$/.exec(stripSeparators(raw).toUpperCase());
  if (!m || iswcCheckDigit(m[1]) !== Number(m[2])) return null;
  const d = m[1];
  return `T-${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${m[2]}`;
}

export function normalizeIpi(raw: string): string | null {
  const v = stripSeparators(raw);
  return IDENTIFIER_PATTERNS.ipi.test(v) ? v : null;
}

const NORMALIZERS: Record<IdentifierKind, (raw: string) => string | null> = {
  isrc: normalizeIsrc,
  upc: normalizeUpc,
  iswc: normalizeIswc,
  ipi: normalizeIpi,
};

export type IdentifierResult = { ok: true; value: string } | { ok: false; error: string };

/** The normalised code, or an error that names the field (`upc: not a valid …`). */
export function parseIdentifier(field: IdentifierKind, raw: string): IdentifierResult {
  const value = NORMALIZERS[field](raw);
  return value === null ? { ok: false, error: `${field}: ${DESCRIPTIONS[field]}` } : { ok: true, value };
}
