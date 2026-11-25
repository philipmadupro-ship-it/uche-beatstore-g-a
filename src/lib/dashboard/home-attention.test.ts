import { describe, expect, it } from 'vitest';
import { buildActionDigest } from './action-digest';
import { buildHomeAttention, summariseDigest } from './home-attention';

const ok = { sales: 'ok', offers: 'ok', leads: 'ok' } as const;
const empty = buildActionDigest({ sales: [], offers: [], leads: [] });
const two = buildActionDigest({
  sales: [{ id: 's', item_label: 'Beat', needs_stems_upload: true, created_at: '2026-11-01T00:00:00Z' }],
  offers: [{ id: 'o', track_title: 'B', buyer_email: 'a@b.co', status: 'pending', created_at: '2026-11-02T00:00:00Z' }],
  leads: [],
});

describe('buildHomeAttention', () => {
  it('is loading, not clear, while any source is loading', () => {
    expect(buildHomeAttention({ digest: empty, sources: { ...ok, offers: 'loading' } }).status).toBe('loading');
  });
  it('is clear only when every source loaded cleanly', () => {
    expect(buildHomeAttention({ digest: empty, sources: ok }).status).toBe('clear');
  });
  it('never says clear when a source failed', () => {
    const a = buildHomeAttention({ digest: empty, sources: { ...ok, sales: 'error' } });
    expect(a.status).toBe('error');
    expect(a.failedSources).toEqual(['sales']);
  });
  it('shows items even if another source failed or is loading, and names the failure', () => {
    const a = buildHomeAttention({ digest: two, sources: { ...ok, leads: 'error' } });
    expect(a.status).toBe('items');
    expect(a.failedSources).toEqual(['leads']);
    expect(buildHomeAttention({ digest: two, sources: { ...ok, leads: 'loading' } }).status).toBe('items');
  });
  it('caps visible rows and counts the rest', () => {
    const a = buildHomeAttention({ digest: two, sources: ok, visibleRows: 1 });
    expect(a.rows).toHaveLength(1);
    expect(a.moreCount).toBe(1);
    expect(a.total).toBe(2);
  });
});

describe('summariseDigest', () => {
  it('pluralises and drops zero domains', () => {
    expect(summariseDigest({ sales: 2, offers: 1, crm: 1 })).toBe('2 sales · 1 offer · 1 lead');
    expect(summariseDigest({ sales: 0, offers: 3, crm: 0 })).toBe('3 offers');
    expect(summariseDigest({ sales: 0, offers: 0, crm: 0 })).toBe('');
  });
});
