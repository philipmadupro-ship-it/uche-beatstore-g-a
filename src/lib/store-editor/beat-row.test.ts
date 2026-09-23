import { describe, it, expect } from 'vitest';
import {
  beatPublishState,
  parsePriceInput,
  matchesAttentionFilter,
  attentionFilterForLabel,
  hasSellablePrice,
} from './beat-row';

const track = (over: Partial<Parameters<typeof beatPublishState>[0]> = {}) => ({
  id: 't1',
  store_listed: false,
  scheduled_publish_at: null,
  ...over,
});

describe('beatPublishState', () => {
  it('reads a listed beat as live even with a stale schedule on the row', () => {
    expect(beatPublishState(track({ store_listed: true, scheduled_publish_at: '2026-09-01T00:00:00Z' })))
      .toBe('live');
  });

  it('reads an unlisted beat with a schedule as scheduled', () => {
    expect(beatPublishState(track({ scheduled_publish_at: '2026-09-01T00:00:00Z' }))).toBe('scheduled');
  });

  it('reads everything else as draft', () => {
    expect(beatPublishState(track())).toBe('draft');
  });
});

describe('parsePriceInput', () => {
  it('treats empty as inherit-the-default, not as free', () => {
    expect(parsePriceInput('')).toEqual({ ok: true, value: null });
    expect(parsePriceInput('   ')).toEqual({ ok: true, value: null });
  });

  it('accepts an explicit zero as an actual zero', () => {
    expect(parsePriceInput('0')).toEqual({ ok: true, value: 0 });
  });

  it('strips a typed dollar sign', () => {
    expect(parsePriceInput('$29.99')).toEqual({ ok: true, value: 29.99 });
  });

  it('rounds to cents rather than rejecting', () => {
    expect(parsePriceInput('19.999')).toEqual({ ok: true, value: 20 });
    expect(parsePriceInput('19.994')).toEqual({ ok: true, value: 19.99 });
  });

  it('rejects nonsense, negatives, and absurd amounts', () => {
    expect(parsePriceInput('abc')).toEqual({ ok: false, reason: 'not-a-number' });
    expect(parsePriceInput('-5')).toEqual({ ok: false, reason: 'negative' });
    expect(parsePriceInput('1000000')).toEqual({ ok: false, reason: 'too-large' });
  });
});

describe('matchesAttentionFilter', () => {
  const base = { store_listed: true, cover_url: null, peaks_url: null, bpm: null, key: null };
  const priced = () => true;
  const unpriced = () => false;

  it('never matches an unlisted beat — the panel is about what is live', () => {
    expect(matchesAttentionFilter('no-cover', { ...base, store_listed: false }, priced)).toBe(false);
  });

  it('matches a listed beat with no cover', () => {
    expect(matchesAttentionFilter('no-cover', base, priced)).toBe(true);
    expect(matchesAttentionFilter('no-cover', { ...base, cover_url: 'x.jpg' }, priced)).toBe(false);
  });

  it('defers to the caller for whether a price is ready', () => {
    expect(matchesAttentionFilter('no-price', base, unpriced)).toBe(true);
    expect(matchesAttentionFilter('no-price', base, priced)).toBe(false);
  });

  it('needs BOTH bpm and key missing to count as no-bpm-key', () => {
    expect(matchesAttentionFilter('no-bpm-key', base, priced)).toBe(true);
    expect(matchesAttentionFilter('no-bpm-key', { ...base, bpm: 140 }, priced)).toBe(false);
    expect(matchesAttentionFilter('no-bpm-key', { ...base, key: 'F#' }, priced)).toBe(false);
  });
});

describe('attentionFilterForLabel', () => {
  it('maps the panel labels the counter produces', () => {
    expect(attentionFilterForLabel('no cover art')).toBe('no-cover');
    expect(attentionFilterForLabel('no price set')).toBe('no-price');
    expect(attentionFilterForLabel('no BPM or key')).toBe('no-bpm-key');
  });

  it('returns null for the waveform issue, which is not a row filter', () => {
    expect(attentionFilterForLabel('need real waveforms')).toBeNull();
  });
});

describe('hasSellablePrice', () => {
  const beat = { id: 't1', lease_price_usd: null, exclusive_price_usd: null };
  const noTiers = { defaultLeasePrice: null, defaultExclusivePrice: null, tiers: [], linksByTrack: {} };

  it('is false when nothing anywhere sets a price', () => {
    expect(hasSellablePrice(beat, noTiers)).toBe(false);
  });

  it('accepts a per-track lease or exclusive price', () => {
    expect(hasSellablePrice({ ...beat, lease_price_usd: 30 }, noTiers)).toBe(true);
    expect(hasSellablePrice({ ...beat, exclusive_price_usd: 300 }, noTiers)).toBe(true);
  });

  it('accepts the producer profile default, including as a form string', () => {
    expect(hasSellablePrice(beat, { ...noTiers, defaultLeasePrice: '25' })).toBe(true);
    expect(hasSellablePrice(beat, { ...noTiers, defaultExclusivePrice: 400 })).toBe(true);
  });

  it('treats a zero or blank default as no price', () => {
    expect(hasSellablePrice(beat, { ...noTiers, defaultLeasePrice: '0' })).toBe(false);
    expect(hasSellablePrice(beat, { ...noTiers, defaultLeasePrice: '' })).toBe(false);
  });

  it('lets tiers take over once they exist', () => {
    const ctx = {
      ...noTiers,
      tiers: [{ id: 'l1', price_usd: 50, is_free: false }],
      linksByTrack: {},
    };
    expect(hasSellablePrice(beat, ctx)).toBe(true);
    expect(hasSellablePrice(beat, { ...ctx, tiers: [{ id: 'l1', price_usd: 0, is_free: false }] })).toBe(false);
  });

  it('counts a free tier as sellable', () => {
    expect(hasSellablePrice(beat, {
      ...noTiers,
      tiers: [{ id: 'l1', price_usd: null, is_free: true }],
    })).toBe(true);
  });

  it('honours a per-track price override on a linked tier', () => {
    const ctx = {
      ...noTiers,
      tiers: [{ id: 'l1', price_usd: 0, is_free: false }],
      linksByTrack: { t1: [{ license_id: 'l1', enabled: true, linked: true, price_override_usd: 40 }] },
    };
    expect(hasSellablePrice(beat, ctx)).toBe(true);
  });

  it('ignores tiers the track is linked away from', () => {
    const ctx = {
      ...noTiers,
      tiers: [
        { id: 'l1', price_usd: 50, is_free: false },
        { id: 'l2', price_usd: 0, is_free: false },
      ],
      linksByTrack: { t1: [
        { license_id: 'l1', enabled: false, linked: true, price_override_usd: null },
        { license_id: 'l2', enabled: true, linked: true, price_override_usd: null },
      ] },
    };
    expect(hasSellablePrice(beat, ctx)).toBe(false);
  });

  it('falls back to legacy prices when the links exclude every tier', () => {
    const ctx = {
      defaultLeasePrice: '25',
      defaultExclusivePrice: null,
      tiers: [{ id: 'l1', price_usd: 50, is_free: false }],
      linksByTrack: { t1: [{ license_id: 'l1', enabled: false, linked: true, price_override_usd: null }] },
    };
    expect(hasSellablePrice(beat, ctx)).toBe(true);
  });
});
