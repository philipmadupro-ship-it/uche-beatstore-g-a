import { describe, expect, it } from 'vitest';
import { looksLikeBankNumber, normalizeCountry, paymentInstructionsError, BANK_NUMBER_CORPUS } from './payee';

describe('looksLikeBankNumber', () => {
  it('refuses IBANs, however they are spaced or cased', () => {
    for (const v of ['GB29 NWBK 6016 1331 9268 19', 'gb29nwbk60161331926819', 'Pay to DE89 3704 0044 0532 0130 00 please', 'FR76-3000-6000-0112-3456-7890-189'.replace(/-/g, ' ')]) {
      expect(looksLikeBankNumber(v), v).toBe(true);
    }
  });

  it('refuses card-number-looking digit runs of 13 to 19 digits', () => {
    for (const v of ['4111 1111 1111 1111', '4111-1111-1111-1111', '4111111111111111', 'card 5500 0000 0000 0004 exp 12/30', '378282246310005']) {
      expect(looksLikeBankNumber(v), v).toBe(true);
    }
  });

  it('accepts plain instructions', () => {
    for (const v of [
      'Pay by bank transfer to the account on file with finance',
      'PayPal: nova@example.com',
      'Invoice monthly, reference RCD-2026-04, net 30',
      'Call +33 6 12 34 56 78 before paying',
      'Pay to the publisher’s client account, details sent by email',
      'Use the Wise link in the contract',
    ]) {
      expect(looksLikeBankNumber(v), v).toBe(false);
    }
  });

  it('every corpus entry the SQL check also holds agrees with the TypeScript rule', () => {
    for (const [value, refused] of BANK_NUMBER_CORPUS) expect(looksLikeBankNumber(value), value).toBe(refused);
  });
});

describe('paymentInstructionsError', () => {
  it('is null for blank and for plain text', () => {
    expect(paymentInstructionsError('')).toBeNull();
    expect(paymentInstructionsError('  Pay via PayPal, ask finance  ')).toBeNull();
  });
  it('explains a refusal in plain words, without echoing the value', () => {
    const msg = paymentInstructionsError('GB29 NWBK 6016 1331 9268 19');
    expect(msg).toMatch(/bank or card number/i);
    expect(msg).not.toContain('NWBK');
  });
  it('bounds the length', () => {
    expect(paymentInstructionsError('a'.repeat(501))).toMatch(/500/);
  });
});

describe('normalizeCountry', () => {
  it('upper-cases a two-letter code and refuses everything else', () => {
    expect(normalizeCountry(' fr ')).toBe('FR');
    expect(normalizeCountry('France')).toBeNull();
    expect(normalizeCountry('F1')).toBeNull();
    expect(normalizeCountry('')).toBeNull();
  });
});
