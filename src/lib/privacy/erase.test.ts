import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  redactedEmailFor,
  isErasedEmail,
  buildPurchaseErasurePatch,
  ERASED_DOMAIN,
} from './erase';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Buyer@Example.COM ')).toBe('buyer@example.com');
  });
});

describe('redactedEmailFor', () => {
  it('is deterministic and case-insensitive', () => {
    expect(redactedEmailFor('Buyer@Example.com')).toBe(redactedEmailFor('buyer@example.com'));
  });

  it('produces an erased-domain pseudonym, never the original', () => {
    const out = redactedEmailFor('buyer@example.com');
    expect(out.endsWith(`@${ERASED_DOMAIN}`)).toBe(true);
    expect(out).not.toContain('buyer@example.com');
  });

  it('differs for different inputs', () => {
    expect(redactedEmailFor('a@example.com')).not.toBe(redactedEmailFor('b@example.com'));
  });
});

describe('isErasedEmail', () => {
  it('recognises already-erased addresses (idempotency guard)', () => {
    expect(isErasedEmail(redactedEmailFor('buyer@example.com'))).toBe(true);
    expect(isErasedEmail('buyer@example.com')).toBe(false);
    expect(isErasedEmail(null)).toBe(false);
  });
});

describe('buildPurchaseErasurePatch', () => {
  it('strips email + stripe customer, keeping the row otherwise intact', () => {
    const patch = buildPurchaseErasurePatch('buyer@example.com');
    expect(patch.buyer_stripe_customer).toBeNull();
    expect(isErasedEmail(patch.buyer_email)).toBe(true);
  });
});
