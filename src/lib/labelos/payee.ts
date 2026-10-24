/**
 * Payee data on a party (LABEL-54). The app never stores a bank number: the
 * "payment instructions" field is free text for finance ("PayPal, ask Sam",
 * "invoice monthly"), and a value that looks like an IBAN or a card number is
 * refused with a plain message.
 *
 * Pure. Migration 174 holds the same two rules in `labelos_looks_like_bank_number`
 * (a CHECK on the column), so a writer that skips the route is stopped too;
 * `BANK_NUMBER_CORPUS` is the shared list of examples both sides are held to
 * (the SQL check asserts the same values).
 */

export const PAYMENT_INSTRUCTIONS_MAX = 500;
export const TAX_ID_MAX = 64;
export const ADDRESS_MAX = 500;

// The leading group keeps a word such as "ref GB29…" from hiding an IBAN and a
// word such as "RCD-2026-04" from looking like one.
const IBAN = /(^|[^A-Za-z0-9])[A-Za-z]{2}[0-9]{2}( ?[A-Za-z0-9]){11,30}/;
// 13 to 19 digits, single spaces or dashes allowed between them.
const CARD = /(^|[^0-9])([0-9][ -]?){12,18}[0-9]([^0-9]|$)/;

export function looksLikeBankNumber(text: string): boolean {
  return IBAN.test(text) || CARD.test(text);
}

/** null = fine. The message never repeats the value. */
export function paymentInstructionsError(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const t = text.trim();
  if (t === '') return null;
  if (t.length > PAYMENT_INSTRUCTIONS_MAX) return `Payment instructions are at most ${PAYMENT_INSTRUCTIONS_MAX} characters`;
  if (looksLikeBankNumber(t)) {
    return 'Payment instructions cannot hold a bank or card number. Say how finance should pay (for example “bank transfer, details on file”) and keep the number out of the app.';
  }
  return null;
}

/** ISO 3166-1 alpha-2 shape: two letters, upper-cased; anything else is null. */
export function normalizeCountry(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

/** [value, refused] — the SQL check (supabase/local/checks/174_*) asserts the same list. */
export const BANK_NUMBER_CORPUS: ReadonlyArray<readonly [string, boolean]> = [
  ['GB29 NWBK 6016 1331 9268 19', true],
  ['gb29nwbk60161331926819', true],
  ['Pay to DE89 3704 0044 0532 0130 00 please', true],
  ['4111 1111 1111 1111', true],
  ['4111-1111-1111-1111', true],
  ['card 5500 0000 0000 0004 exp 12/30', true],
  ['378282246310005', true],
  ['PayPal: nova@example.com', false],
  ['Invoice monthly, reference RCD-2026-04, net 30', false],
  ['Call +33 6 12 34 56 78 before paying', false],
  ['Pay by bank transfer to the account on file with finance', false],
];
