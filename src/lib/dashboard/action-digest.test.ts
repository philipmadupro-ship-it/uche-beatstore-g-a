import { describe, it, expect } from 'vitest';
import { buildActionDigest, type DigestSaleRow, type DigestOfferRow, type DigestLeadRow } from './action-digest';

describe('buildActionDigest', () => {
  it('returns an empty digest when nothing needs attention', () => {
    const d = buildActionDigest({ sales: [], offers: [], leads: [] });
    expect(d.total).toBe(0);
    expect(d.items).toEqual([]);
    expect(d.countsByDomain).toEqual({ sales: 0, offers: 0, crm: 0 });
  });

  it('emits one item per outstanding sale flag, and none for clean sales', () => {
    const sales: DigestSaleRow[] = [
      { id: 's1', item_label: 'Yeat Synth', needs_stems_upload: true, created_at: '2026-01-01T10:00:00Z' },
      { id: 's2', item_label: 'Word Without You', needs_refund_review: true, created_at: '2026-01-02T10:00:00Z' },
      { id: 's3', item_label: 'Clean Sale', created_at: '2026-01-03T10:00:00Z' },
    ];
    const d = buildActionDigest({ sales, offers: [], leads: [] });
    expect(d.total).toBe(2);
    expect(d.items.map((i) => i.label)).toEqual(['Needs refund review', 'Awaiting stems']); // newest first
    expect(d.countsByDomain.sales).toBe(2);
  });

  it('emits one item per sale that has BOTH flags set', () => {
    const sales: DigestSaleRow[] = [
      { id: 's1', item_label: 'Both', needs_stems_upload: true, needs_refund_review: true, created_at: '2026-01-01T10:00:00Z' },
    ];
    const d = buildActionDigest({ sales, offers: [], leads: [] });
    expect(d.total).toBe(2);
  });

  it('only counts pending offers, not accepted/countered/declined', () => {
    const offers: DigestOfferRow[] = [
      { id: 'o1', track_title: 'A', buyer_email: 'a@x.com', status: 'pending', created_at: '2026-02-01T10:00:00Z' },
      { id: 'o2', track_title: 'B', buyer_email: 'b@x.com', status: 'accepted', created_at: '2026-02-02T10:00:00Z' },
      { id: 'o3', track_title: 'C', buyer_email: 'c@x.com', status: 'declined', created_at: '2026-02-03T10:00:00Z' },
    ];
    const d = buildActionDigest({ sales: [], offers, leads: [] });
    expect(d.total).toBe(1);
    expect(d.items[0].detail).toBe('A — a@x.com');
    expect(d.countsByDomain.offers).toBe(1);
  });

  it('emits one item per new lead, linking to their contact page', () => {
    const leads: DigestLeadRow[] = [
      { id: 'c1', name: 'DJ Test', email: 'dj@test.com', created_at: '2026-03-01T10:00:00Z' },
    ];
    const d = buildActionDigest({ sales: [], offers: [], leads });
    expect(d.total).toBe(1);
    expect(d.items[0].href).toBe('/contacts/c1');
    expect(d.items[0].detail).toBe('DJ Test');
    expect(d.countsByDomain.crm).toBe(1);
  });

  it('falls back to email when a lead has no name', () => {
    const leads: DigestLeadRow[] = [{ id: 'c1', name: '', email: 'dj@test.com', created_at: '2026-03-01T10:00:00Z' }];
    const d = buildActionDigest({ sales: [], offers: [], leads });
    expect(d.items[0].detail).toBe('dj@test.com');
  });

  it('merges all three domains sorted newest-first regardless of source', () => {
    const sales: DigestSaleRow[] = [
      { id: 's1', item_label: 'Old sale issue', needs_stems_upload: true, created_at: '2026-01-01T10:00:00Z' },
    ];
    const offers: DigestOfferRow[] = [
      { id: 'o1', track_title: 'Mid offer', buyer_email: 'a@x.com', status: 'pending', created_at: '2026-01-15T10:00:00Z' },
    ];
    const leads: DigestLeadRow[] = [
      { id: 'c1', name: 'Newest lead', email: null, created_at: '2026-01-20T10:00:00Z' },
    ];
    const d = buildActionDigest({ sales, offers, leads });
    expect(d.items.map((i) => i.domain)).toEqual(['crm', 'offers', 'sales']);
    expect(d.total).toBe(3);
  });
});
