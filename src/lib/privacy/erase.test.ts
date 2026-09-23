import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  redactedEmailFor,
  isErasedEmail,
  buildPurchaseErasurePatch,
  buildErasurePlan,
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

describe('buildErasurePlan', () => {
  const plan = buildErasurePlan('buyer@example.com');
  const pseudonym = redactedEmailFor('buyer@example.com');

  it('covers every table that stores a buyer email', () => {
    expect([...new Set(plan.map((s) => s.table))].sort()).toEqual([
      'abandoned_carts', 'beat_comments', 'buyer_favorites', 'buyer_listening_history', 'buyer_offers',
      'buyer_playlists', 'contacts', 'drop_subscribers', 'fulfillment_email_jobs', 'license_purchases',
      'producer_follows', 'project_access_links', 'store_free_downloads',
    ]);
  });

  it('never writes the original email, only the pseudonym or null', () => {
    expect(JSON.stringify(plan.map((s) => s.patch ?? null))).not.toContain('buyer@example.com');
    for (const step of plan.filter((s) => s.action === 'anonymise')) {
      const value = step.patch?.[step.emailColumn];
      expect([pseudonym, null]).toContain(value);
    }
  });

  it('keeps financial records and deletes behavioural ones', () => {
    const action = (t: string) => plan.filter((s) => s.table === t).map((s) => s.action);
    expect(action('license_purchases')).toEqual(['anonymise']);
    expect(action('contacts')).toEqual(['anonymise']);
    expect(action('buyer_favorites')).toEqual(['delete']);
    expect(action('abandoned_carts')).toEqual(['delete']);
  });

  it('scopes every table that has a producer column', () => {
    const scope = Object.fromEntries(plan.map((s) => [s.table, s.scope]));
    expect(scope).toMatchObject({
      license_purchases: 'seller_user_id', project_access_links: 'seller_user_id', buyer_offers: 'seller_user_id',
      fulfillment_email_jobs: 'seller_user_id', contacts: 'user_id', beat_comments: 'seller_user_id',
      abandoned_carts: 'seller_user_id', producer_follows: 'producer_user_id',
    });
  });

  it('retires unsent delivery emails but leaves sent ones marked sent', () => {
    const jobs = plan.filter((s) => s.table === 'fulfillment_email_jobs');
    expect(jobs.find((s) => s.where?.op === 'neq')?.patch).toMatchObject({ status: 'dead' });
    expect(jobs.find((s) => s.where?.op === 'eq')?.patch).not.toHaveProperty('status');
  });

  it('gives every step a distinct response key', () => {
    expect(new Set(plan.map((s) => s.key)).size).toBe(plan.length);
  });
});
