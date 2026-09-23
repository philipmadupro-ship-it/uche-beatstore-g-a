import { describe, it, expect, vi } from 'vitest';
import { linkBuyerToCrm, type BuyerCrmClient } from './link-buyer';

/**
 * Records what the helper sent to Postgres so the regression that motivated
 * it — SELECT-then-INSERT racing the unique index and silently losing the
 * contact id — cannot come back unnoticed.
 */
function mockAdmin(opts: {
  insertError?: { message: string } | null;
  updateError?: { message: string } | null;
  contact?: { id?: string } | null;
} = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.contact === undefined ? { id: 'contact-1' } : opts.contact,
    error: opts.updateError ?? null,
  });
  const update = vi.fn(() => ({
    eq: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }),
  }));
  const admin = { from: vi.fn(() => ({ upsert, update })) } as unknown as BuyerCrmClient;
  return { admin, upsert, update, maybeSingle };
}

describe('linkBuyerToCrm', () => {
  it('upserts on the (user_id, email) index — the constraint mig 096 created', async () => {
    const { admin, upsert } = mockAdmin();
    await linkBuyerToCrm(admin, {
      sellerUserId: 'seller-1', email: 'buyer@example.com', name: 'Buyer', notes: 'Purchased via store',
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [, opts] = upsert.mock.calls[0];
    expect(opts.onConflict).toBe('user_id,email');
  });

  it('never clobbers a returning buyer\'s producer-curated fields', async () => {
    const { admin, upsert } = mockAdmin();
    await linkBuyerToCrm(admin, {
      sellerUserId: 'seller-1', email: 'buyer@example.com', name: 'Customer', notes: 'n',
    });
    const [, opts] = upsert.mock.calls[0];
    expect(opts.ignoreDuplicates).toBe(true);
  });

  it('normalises the email before writing or matching', async () => {
    const { admin, upsert } = mockAdmin();
    await linkBuyerToCrm(admin, {
      sellerUserId: 'seller-1', email: '  Buyer@Example.COM ', name: 'Buyer', notes: 'n',
    });
    const [values] = upsert.mock.calls[0];
    expect(values.email).toBe('buyer@example.com');
  });

  it('returns the contact id for both new and existing buyers', async () => {
    const { admin } = mockAdmin({ contact: { id: 'contact-42' } });
    const id = await linkBuyerToCrm(admin, {
      sellerUserId: 'seller-1', email: 'buyer@example.com', name: 'Buyer', notes: 'n',
    });
    // The id is what the caller needs to log the purchase to the timeline —
    // losing it is exactly how sales went missing from the CRM.
    expect(id).toBe('contact-42');
  });

  it('advances BOTH status columns on every purchase', async () => {
    const { admin, update, upsert } = mockAdmin();
    await linkBuyerToCrm(admin, {
      sellerUserId: 'seller-1', email: 'buyer@example.com', name: 'Buyer', notes: 'n',
    });
    expect(upsert.mock.calls[0][0].buyer_pipeline_status).toBe('purchased');
    expect(upsert.mock.calls[0][0].crm_status).toBe('customer');
    // crm_status is the one the CRM stage cell actually renders — updating
    // buyer_pipeline_status alone is why a sale never moved the pipeline.
    expect(update).toHaveBeenCalledWith({
      buyer_pipeline_status: 'purchased',
      crm_status: 'customer',
    });
  });

  it('returns null (not a throw) when the insert reports an error', async () => {
    const { admin } = mockAdmin({ insertError: { message: 'duplicate key' } });
    await expect(linkBuyerToCrm(admin, {
      sellerUserId: 'seller-1', email: 'buyer@example.com', name: 'Buyer', notes: 'n',
    })).resolves.toBeNull();
  });

  it('returns null when the status update reports an error', async () => {
    const { admin } = mockAdmin({ updateError: { message: 'boom' } });
    await expect(linkBuyerToCrm(admin, {
      sellerUserId: 'seller-1', email: 'buyer@example.com', name: 'Buyer', notes: 'n',
    })).resolves.toBeNull();
  });

  it('swallows a thrown client error so fulfillment never fails on CRM', async () => {
    const admin = { from: () => { throw new Error('network'); } } as unknown as BuyerCrmClient;
    await expect(linkBuyerToCrm(admin, {
      sellerUserId: 'seller-1', email: 'buyer@example.com', name: 'Buyer', notes: 'n',
    })).resolves.toBeNull();
  });

  it('refuses a blank email rather than writing an empty contact', async () => {
    const { admin, upsert } = mockAdmin();
    const id = await linkBuyerToCrm(admin, {
      sellerUserId: 'seller-1', email: '   ', name: 'Buyer', notes: 'n',
    });
    expect(id).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });
});
