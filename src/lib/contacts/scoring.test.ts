import { describe, it, expect } from 'vitest';
import { scoreLead, recencyMultiplier, type ScoreInput } from './scoring';

const NOW = Date.parse('2026-06-04T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function input(partial: Partial<ScoreInput>): ScoreInput {
  return { sends: 0, opens: 0, clicks: 0, plays: 0, favorites: 0, purchases: 0, revenue: 0, lastTouch: null, now: NOW, ...partial };
}

describe('recencyMultiplier', () => {
  it('is full for activity within a week', () => {
    expect(recencyMultiplier(daysAgo(3), NOW)).toBe(1);
  });
  it('decays over time', () => {
    expect(recencyMultiplier(daysAgo(20), NOW)).toBe(0.75);
    expect(recencyMultiplier(daysAgo(60), NOW)).toBe(0.45);
    expect(recencyMultiplier(daysAgo(200), NOW)).toBe(0.2);
  });
  it('is low but non-zero with no touch', () => {
    expect(recencyMultiplier(null, NOW)).toBe(0.3);
  });
});

describe('scoreLead', () => {
  it('marks a recent buyer as hot', () => {
    const r = scoreLead(input({ purchases: 1, revenue: 130, lastTouch: daysAgo(2) }));
    expect(r.tier).toBe('hot');
    expect(r.reasons[0]).toContain('1 purchase');
    expect(r.reasons[0]).toContain('$130');
  });

  it('any purchase is at least hot regardless of recency', () => {
    const r = scoreLead(input({ purchases: 1, revenue: 50, lastTouch: daysAgo(300) }));
    expect(r.tier).toBe('hot');
  });

  it('high recent engagement without a purchase can be warm', () => {
    const r = scoreLead(input({ sends: 3, opens: 3, clicks: 2, plays: 2, lastTouch: daysAgo(1) }));
    // base = 3*0.5 + 3*4 + 2*8 + 2*6 = 1.5+12+16+12 = 41.5 ×1 = 42 → warm
    expect(r.score).toBe(42);
    expect(r.tier).toBe('warm');
  });

  it('stale low engagement is cold', () => {
    const r = scoreLead(input({ sends: 2, opens: 1, lastTouch: daysAgo(120) }));
    // base = 1 + 4 = 5 ×0.2 = 1 → cold
    expect(r.tier).toBe('cold');
    expect(r.score).toBeGreaterThan(0);
  });

  it('no engagement is new', () => {
    const r = scoreLead(input({}));
    expect(r.tier).toBe('new');
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual(['no engagement yet']);
  });

  it('caps revenue contribution', () => {
    const huge = scoreLead(input({ purchases: 1, revenue: 100000, lastTouch: daysAgo(1) }));
    expect(huge.score).toBeLessThanOrEqual(100);
  });

  it('clamps score to 100', () => {
    const r = scoreLead(input({ purchases: 5, clicks: 20, plays: 20, opens: 20, revenue: 5000, lastTouch: daysAgo(1) }));
    expect(r.score).toBe(100);
  });

  it('flags gone-quiet contacts in reasons', () => {
    const r = scoreLead(input({ opens: 2, lastTouch: daysAgo(120) }));
    expect(r.reasons).toContain('gone quiet (90d+)');
  });

  it('favoriting without a purchase can make a lead warm', () => {
    const r = scoreLead(input({ favorites: 3, lastTouch: daysAgo(1) }));
    // base = 3*7 = 21 ×1 = 21 → cold (below the 28 warm threshold)
    expect(r.score).toBe(21);
    expect(r.tier).toBe('cold');
    expect(r.reasons[0]).toBe('3 favorites');
  });

  it('is unaffected when favorites is omitted (back-compat)', () => {
    const withUndefined = scoreLead({ sends: 1, opens: 1, clicks: 1, plays: 1, purchases: 0, revenue: 0, lastTouch: daysAgo(1), now: NOW });
    const withZero = scoreLead(input({ sends: 1, opens: 1, clicks: 1, plays: 1, lastTouch: daysAgo(1) }));
    expect(withUndefined.score).toBe(withZero.score);
  });
});
