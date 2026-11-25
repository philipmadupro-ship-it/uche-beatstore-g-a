import { describe, it, expect } from 'vitest';
import { buildTierDraft, parseTierRef } from './license-draft';

const ROW = {
  id: '33333333-3333-4333-8333-333333333333', user_id: 'secret-owner-id', name: 'Gold', price_usd: 60, is_exclusive: false,
  file_types: ['mp3', 'wav'], stems_included: false, streaming_limit: 250000, distribution_limit: null,
  commercial_rights: true, sync_rights: false, broadcast_rights: false, credit_required: false, description: 'PRIVATE TAGLINE',
};

describe('parseTierRef', () => {
  it('accepts a uuid and the two legacy ids only', () => {
    expect(parseTierRef(ROW.id)).toEqual({ kind: 'uuid', id: ROW.id });
    expect(parseTierRef('lease')).toEqual({ kind: 'legacy', id: 'lease' });
    expect(parseTierRef('exclusive')).toEqual({ kind: 'legacy', id: 'exclusive' });
    for (const bad of ['', 'Lease', 'lease ', 'gold', '1', '../x', `${ROW.id}x`]) expect(parseTierRef(bad)).toBeNull();
  });
});

describe('buildTierDraft', () => {
  it('is dated the day the draft is made, like a buyer\'s contract, not a fixed sample date', () => {
    const d = buildTierDraft({ tierRow: ROW, template: '', now: new Date(2026, 10, 25, 12) });
    expect(d.markdown).toContain('on November 25, 2026.');
    expect(d.markdown).not.toContain('May 27, 2026');
    expect(buildTierDraft({ tierRow: ROW, template: '' }).markdown).toContain(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  });
  it('states the row, and carries nothing else of it', () => {
    const d = buildTierDraft({ tierRow: ROW, template: '', producerName: 'Uche', producerEmail: 'u@example.test' });
    expect(d.tier).toEqual({ name: 'Gold', source: 'licenses-row', issues: [] });
    expect(d.schedule).toContain('- Audio streams: 250,000 streams');
    expect(d.schedule).toContain('- Credit: Not required');
    expect(d.markdown).toContain('Uche');
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/secret-owner-id|PRIVATE TAGLINE|price_usd/);
    expect(Object.keys(d).sort()).toEqual(['alerts', 'draft', 'markdown', 'sample', 'schedule', 'template_source', 'tier', 'verification']);
  });
  it('uses the wording it is given and says whose it is', () => {
    expect(buildTierDraft({ tierRow: ROW, template: '# Mine' }).template_source).toBe('producer');
    expect(buildTierDraft({ tierRow: ROW, template: '   ' }).template_source).toBe('tier-aware');
    expect(buildTierDraft({ tierRow: ROW, template: null }).template_source).toBe('tier-aware');
  });
  it('legacy ids', () => {
    const l = buildTierDraft({ legacyId: 'lease', template: '' });
    expect(l.tier.source).toBe('legacy');
    expect(l.schedule).toContain('(Non-exclusive)');
    expect(buildTierDraft({ legacyId: 'exclusive', template: '' }).schedule).toContain('(Exclusive)');
  });
  it('a corrupt row falls back, flagged', () => {
    const d = buildTierDraft({ tierRow: { ...ROW, streaming_limit: NaN, file_types: ['OGG'] }, template: '' });
    expect(d.tier.source).toBe('fallback');
    expect(d.tier.issues.length).toBeGreaterThan(0);
    expect(d.alerts.join()).toMatch(/standard terms/);
  });
  it('missing producer details read plainly', () => {
    expect(buildTierDraft({ tierRow: { ...ROW, credit_required: true }, template: '' }).schedule).toContain('- Credit: prod. Producer');
  });
});
