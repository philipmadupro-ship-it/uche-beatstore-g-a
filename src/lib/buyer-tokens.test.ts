/**
 * Unit tests for signBuyerToken / verifyBuyerToken.
 *
 * Covers the security-relevant invariants:
 *   - round-trip: a signed token verifies back to the same email
 *   - case-insensitive normalization on the email
 *   - signature mismatch (tampered email)  → null
 *   - signature mismatch (tampered exp)    → null
 *   - signature mismatch (wrong key)       → null
 *   - expired token (exp in the past)      → null
 *   - malformed inputs                     → null
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signBuyerToken, verifyBuyerToken } from './buyer-tokens';

const ORIGINAL_KEY = process.env.STRIPE_WEBHOOK_SECRET;

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'test-secret-key-do-not-use-in-prod';
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_KEY;
});

describe('buyer-tokens', () => {
  it('round-trips a normal email', () => {
    const token = signBuyerToken('Buyer@Example.com');
    const claims = verifyBuyerToken(token);
    expect(claims).not.toBeNull();
    expect(claims?.email).toBe('buyer@example.com');
    expect(claims!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a token whose email segment has been swapped', () => {
    const token = signBuyerToken('a@example.com');
    const [, exp, sig] = token.split('.');
    const tampered = `${Buffer.from('b@example.com').toString('base64url')}.${exp}.${sig}`;
    expect(verifyBuyerToken(tampered)).toBeNull();
  });

  it('rejects a token whose expiry has been pushed forward', () => {
    const token = signBuyerToken('a@example.com');
    const [emailB64, , sig] = token.split('.');
    const futureExp = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    expect(verifyBuyerToken(`${emailB64}.${futureExp}.${sig}`)).toBeNull();
  });

  it('rejects a token signed with a different key', () => {
    const token = signBuyerToken('a@example.com');
    process.env.STRIPE_WEBHOOK_SECRET = 'different-secret';
    expect(verifyBuyerToken(token)).toBeNull();
  });

  it('rejects an expired token', () => {
    const emailB64 = Buffer.from('a@example.com').toString('base64url');
    const exp = Math.floor(Date.now() / 1000) - 1;
    const { createHmac } = require('node:crypto');
    const sig = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
      .update(`${emailB64}.${exp}`)
      .digest('base64url');
    expect(verifyBuyerToken(`${emailB64}.${exp}.${sig}`)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyBuyerToken('')).toBeNull();
    expect(verifyBuyerToken('just-one-segment')).toBeNull();
    expect(verifyBuyerToken('one.two')).toBeNull();
    expect(verifyBuyerToken('a.b.c.d')).toBeNull();
  });

  it('refuses to sign an empty email', () => {
    expect(() => signBuyerToken('')).toThrow();
    expect(() => signBuyerToken('   ')).toThrow();
  });
});
