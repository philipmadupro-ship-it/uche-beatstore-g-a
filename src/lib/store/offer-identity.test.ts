import { describe, it, expect } from 'vitest';
import { isMissingOfferVerifiedColumn, resolveOfferIdentity } from './offer-identity';

describe('resolveOfferIdentity', () => {
  it('a session email wins and the body email is ignored', () => {
    expect(resolveOfferIdentity('Me@Example.test', 'victim@example.test')).toEqual({ email: 'me@example.test', verified: true });
  });

  it('with no session the claimed email is kept, normalised, and unverified', () => {
    expect(resolveOfferIdentity(null, '  Victim@Example.TEST ')).toEqual({ email: 'victim@example.test', verified: false });
    expect(resolveOfferIdentity(undefined, 'a@b.test').verified).toBe(false);
  });

  it('a session without an email proves nothing', () => {
    expect(resolveOfferIdentity('', 'a@b.test')).toEqual({ email: 'a@b.test', verified: false });
    expect(resolveOfferIdentity('   ', 'a@b.test').verified).toBe(false);
  });
});

describe('isMissingOfferVerifiedColumn', () => {
  it('recognises a write and a filter on the missing column', () => {
    expect(isMissingOfferVerifiedColumn({ code: 'PGRST204', message: "Could not find the 'buyer_email_verified' column of 'buyer_offers' in the schema cache" })).toBe(true);
    expect(isMissingOfferVerifiedColumn({ code: '42703', message: 'column buyer_offers.buyer_email_verified does not exist' })).toBe(true);
  });

  it('does not swallow any other failure', () => {
    expect(isMissingOfferVerifiedColumn({ code: '42703', message: 'column buyer_offers.other does not exist' })).toBe(false);
    expect(isMissingOfferVerifiedColumn({ code: '23505', message: 'buyer_email_verified duplicate' })).toBe(false);
    expect(isMissingOfferVerifiedColumn(null)).toBe(false);
    expect(isMissingOfferVerifiedColumn('buyer_email_verified')).toBe(false);
  });
});
